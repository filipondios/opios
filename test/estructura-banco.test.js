import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirDb } from "../src/db.js";
import { importarDirectorio } from "../src/seed.js";
import { validarBanco } from "../src/validar-banco.js";
import { archivosDeBanco, clasificarBanco, clasificarBloque, recorrerBanco } from "../src/estructura-banco.js";

const DIR_BLOQUES = join(import.meta.dir, "fixtures-bloques");
const RAIZ = join(import.meta.dir, "..");

describe("estructura del banco (Fase 2.5)", () => {
    test("clasificarBanco acepta bloque_N y avisa de los nombres parecidos", () => {
        const r = clasificarBanco("/banco", ["bloque_1", "Bloque_1", "bloque_01", "examenes", "notas.txt"]);
        expect(r.bloques.map((b) => b.nombre)).toEqual(["bloque_1"]);
        expect(r.avisos.some((a) => a.includes("Bloque_1"))).toBe(true);
        expect(r.avisos.some((a) => a.includes("bloque_01"))).toBe(true);
        expect(r.ignorados.some((i) => i.nombre === "examenes")).toBe(true);
    });

    test("clasificarBloque acepta tema_N.json y avisa de TEMA_1.JSON y tema_01.json", () => {
        const r = clasificarBloque("/banco", "bloque_1", [
            "info.json",
            "tema_1.json",
            "TEMA_1.JSON",
            "tema_01.json",
            "notas.md",
        ]);
        expect(r.info?.nombre).toBe("info.json");
        expect(r.temas.map((t) => t.nombre)).toEqual(["tema_1.json"]);
        expect(r.avisos.some((a) => a.includes("TEMA_1.JSON"))).toBe(true);
        expect(r.avisos.some((a) => a.includes("tema_01.json"))).toBe(true);
    });

    test("recorrerBanco ignora generated/ y archivosDeBanco lo añade con --incluir", async () => {
        const banco = await recorrerBanco(DIR_BLOQUES);
        expect(banco.bloques.map((b) => b.nombre)).toEqual(["bloque_1", "bloque_2", "bloque_3"]);
        expect(banco.ignorados.some((i) => i.ruta.includes("generated"))).toBe(true);

        const sin = await archivosDeBanco(DIR_BLOQUES);
        expect(sin.archivos.some((f) => f.ruta.includes("generated"))).toBe(false);

        const con = await archivosDeBanco(DIR_BLOQUES, { incluye: ["generated"] });
        expect(con.archivos.some((f) => f.ruta.includes("generated"))).toBe(true);
    });

    test("seed y validar ignoran generated/ y examenes/", async () => {
        const repo = abrirDb(":memory:");
        try {
            const r = await importarDirectorio(repo, DIR_BLOQUES);
            expect(r.errores).toEqual([]);
            expect(repo.todas().some((p) => p.pregunta.includes("generated"))).toBe(false);

            const v = await validarBanco(repo, DIR_BLOQUES);
            expect(v.errores).toEqual([]);
            expect(v.nuevas).toBe(0); // ya estaba importado
        } finally {
            repo.close();
        }
    });

    test("calidad --incluir generated analiza la carpeta extra", () => {
        const sin = Bun.spawnSync({
            cmd: ["bun", "scripts/calidad.js", DIR_BLOQUES],
            cwd: RAIZ,
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(sin.exitCode).toBe(0);
        expect(sin.stdout.toString()).not.toContain("generated/tema_9.json");

        const con = Bun.spawnSync({
            cmd: ["bun", "scripts/calidad.js", DIR_BLOQUES, "--incluir", "generated"],
            cwd: RAIZ,
            stdout: "pipe",
            stderr: "pipe",
        });
        expect(con.exitCode).toBe(0);
        expect(con.stdout.toString()).toContain("generated/tema_9.json");
    });

    test("ids --incluir generated comparte el id entre el tema y su copia", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-ids-"));
        try {
            const pregunta = { pregunta: "¿Misma pregunta?", respuestas: ["Sí", "No"], respuesta_correcta: "a" };
            await Bun.write(join(dir, "bloque_1/tema_1.json"), JSON.stringify([pregunta]));
            await Bun.write(join(dir, "bloque_1/generated/tema_1.json"), JSON.stringify([pregunta]));

            const r = Bun.spawnSync({
                cmd: ["bun", "scripts/ids.js", dir, "--incluir", "generated"],
                cwd: RAIZ,
                stdout: "pipe",
                stderr: "pipe",
            });
            expect(r.exitCode).toBe(0);

            const a = (await Bun.file(join(dir, "bloque_1/tema_1.json")).json())[0];
            const b = (await Bun.file(join(dir, "bloque_1/generated/tema_1.json")).json())[0];
            expect(a.id_externo).toBeTruthy();
            expect(b.id_externo).toBe(a.id_externo);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
