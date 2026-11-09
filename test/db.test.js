import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirDb } from "../src/db.js";

const RAIZ = join(import.meta.dir, "..");

describe("fiabilidad de la base de datos (Fase 2.1)", () => {
    test("abrirDb activa busy_timeout y synchronous = NORMAL", () => {
        const repo = abrirDb(":memory:");
        try {
            expect(repo.db.query("PRAGMA busy_timeout").get().timeout).toBe(5000);
            expect(repo.db.query("PRAGMA synchronous").get().synchronous).toBe(1); // NORMAL
        } finally {
            repo.close();
        }
    });

    test("una segunda conexión espera y escribe en lugar de fallar con SQLITE_BUSY", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-busy-"));
        const ruta = join(dir, "opios.db");
        const listo = join(dir, "listo");
        const repo = abrirDb(ruta);
        const otro = abrirDb(ruta);
        try {
            /* Un proceso aparte retiene un BEGIN IMMEDIATE durante 400 ms. */
            const hijo = Bun.spawn({
                cmd: [
                    "bun",
                    "-e",
                    `(async () => {
    const { Database } = await import("bun:sqlite");
    const { writeFileSync } = await import("node:fs");
    const db = new Database(${JSON.stringify(ruta)});
    db.run("PRAGMA busy_timeout = 5000");
    db.run("BEGIN IMMEDIATE");
    writeFileSync(${JSON.stringify(listo)}, "1");
    await Bun.sleep(400);
    db.run("COMMIT");
    db.close();
})();`,
                ],
                stdout: "pipe",
                stderr: "pipe",
            });

            const limite = Date.now() + 5000;
            while (!existsSync(listo) && Date.now() < limite) await Bun.sleep(20);
            expect(existsSync(listo)).toBe(true);

            const t0 = Date.now();
            otro.guardarAjuste("prueba", "ok");
            const espera = Date.now() - t0;

            expect(espera).toBeGreaterThan(100);
            expect(otro.ajustes().prueba).toBe("ok");
            await hijo.exited;
            expect(hijo.exitCode).toBe(0);
        } finally {
            otro.close();
            repo.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("los CLI resumen el error en una línea y salen con código 1", () => {
        const r = Bun.spawnSync({
            cmd: ["bun", "scripts/export.js"],
            cwd: RAIZ,
            env: { ...process.env, OPIOS_DB: "/dev/null/opios.db" },
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(r.exitCode).toBe(1);
        const err = r.stderr.toString();
        expect(err).toContain("error:");
        expect(err).not.toContain("    at ");
    });
});
