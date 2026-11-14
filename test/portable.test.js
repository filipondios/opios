import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { abrirDb } from "../src/db.js";
import { exportarBanco, importarBancoOpios, FORMATO } from "../src/portable.js";
import { importarDirectorio } from "../src/seed.js";

const DIR_FIXTURE = join(import.meta.dir, "fixtures");

describe("banco portable .opios (task 8)", () => {
    test("exportar e importar conserva preguntas y progreso (ida y vuelta)", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-portable-"));
        try {
            /* Banco con preguntas, progreso y simulacros. */
            const banco = join(dir, "banco.db");
            const repo = abrirDb(banco);
            await importarDirectorio(repo, DIR_FIXTURE);
            const pregunta = repo.todas()[0];
            repo.guardarProgreso([{ id: pregunta.id, caja: 3, vence: "2999-01-01", aciertos: 2, fallos: 1 }]);
            repo.close();

            const paquete = join(dir, "banco.opios");
            const m = exportarBanco(banco, paquete, { nombre: "Mi banco" });
            expect(m).toMatchObject({ formato: FORMATO, app: "opios", nombre: "Mi banco", preguntas: 7 });
            expect(paquete.endsWith(".opios")).toBe(true);
            expect(existsSync(paquete + ".tmp")).toBe(false); // no quedan temporales

            const restaurado = join(dir, "restaurado.db");
            const m2 = importarBancoOpios(paquete, restaurado);
            expect(m2).toMatchObject({ nombre: "Mi banco", preguntas: 7 });

            /* El banco restaurado es idéntico en contenido (VACUUM conserva ids y datos). */
            const repo1 = abrirDb(banco);
            const repo2 = abrirDb(restaurado);
            try {
                expect(repo2.todas()).toEqual(repo1.todas());
            } finally {
                repo1.close();
                repo2.close();
            }
            const repo2b = abrirDb(restaurado);
            expect(repo2b.paraTest([1]).progreso[pregunta.id]).toEqual([3, "2999-01-01", 2, 1]);
            repo2b.close();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("rechaza: no-.opios, formato futuro, SQLite rota y destino existente", () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-portable-malo-"));
        try {
            const banco = join(dir, "banco.db");
            abrirDb(banco).close();

            /* Destino existente no se pisa. */
            const ocupado = join(dir, "ocupado.opios");
            exportarBanco(banco, ocupado);
            expect(() => exportarBanco(banco, ocupado)).toThrow(/Ya existe/);

            /* Un archivo cualquiera no es un .opios. */
            const falso = join(dir, "falso.opios");
            writeFileSync(falso, "no es un banco");
            expect(() => importarBancoOpios(falso, join(dir, "x.db"))).toThrow(/no es gzip|cabecera/);

            /* Formato futuro: cabecera correcta, manifest con formato mayor. */
            const futuro = join(dir, "futuro.opios");
            const mBuf = Buffer.from(JSON.stringify({ formato: 99 }));
            const cab = Buffer.alloc(12 + 4);
            Buffer.from("opios-banco\0").copy(cab, 0);
            cab.writeUInt32LE(mBuf.length, 12);
            writeFileSync(futuro, Bun.gzipSync(Buffer.concat([cab, mBuf])));
            expect(() => importarBancoOpios(futuro, join(dir, "y.db"))).toThrow(/no soportado/);

            /* SQLite truncada (integridad rota) no se restaura en silencio. */
            const paquete = join(dir, "ok.opios");
            exportarBanco(banco, paquete);
            const bueno = Bun.gunzipSync(readFileSync(paquete));
            const roto = bueno.subarray(0, Math.floor(bueno.length / 2));
            const truncado = join(dir, "truncado.opios");
            writeFileSync(truncado, Bun.gzipSync(roto));
            expect(() => importarBancoOpios(truncado, join(dir, "z.db"))).toThrow();
            expect(existsSync(join(dir, "z.db"))).toBe(false); // el destino fallido no queda creado
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
