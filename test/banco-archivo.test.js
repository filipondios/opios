/* Detección de archivos del asistente de importación (F3.4): un sitio para la regla. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectarArchivo } from "../src/banco-archivo.js";
import { contenedor, comprimir } from "../src/portable.js";
import { abrirDb } from "../src/db.js";

const jsonLista = JSON.stringify([{ pregunta: "¿Uno?", respuestas: ["A", "B"], respuesta_correcta: "a" }]);

describe("detectarArchivo", () => {
    test("reconoce JSON suelto (array) y envuelto ({preguntas})", async () => {
        const a = await detectarArchivo(new TextEncoder().encode(jsonLista));
        expect(a.tipo).toBe("json");
        expect(a.preguntas).toHaveLength(1);
        const b = await detectarArchivo(
            new TextEncoder().encode(
                JSON.stringify({ preguntas: [{ pregunta: "¿Uno?", respuestas: ["A", "B"], respuesta_correcta: "a" }] }),
            ),
        );
        expect(b.tipo).toBe("json");
        await expect(detectarArchivo(new TextEncoder().encode('{"no": 1}'))).rejects.toThrow(/lista de preguntas/);
        await expect(detectarArchivo(new TextEncoder().encode(JSON.stringify({ preguntas: [] })))).rejects.toThrow(
            /ninguna pregunta/,
        );
    });

    test("reconoce .opios (gzip + cabecera) y extrae su SQLite", async () => {
        const sqlite = new Uint8Array([1, 2, 3, 4]);
        const bytes = await comprimir(contenedor({ formato: 1, nombre: "Mio" }, sqlite));
        const r = await detectarArchivo(bytes);
        expect(r.tipo).toBe("opios");
        expect(r.manifest).toMatchObject({ formato: 1, nombre: "Mio" });
        expect([...r.sqlite]).toEqual([1, 2, 3, 4]);
    });

    test("gzip corrupto, gzip que no es .opios, zip, SQLite, basura y archivo corto", async () => {
        await expect(detectarArchivo(new Uint8Array([0x1f, 0x8b, 0x01, 0x02, 0x03, 4, 5, 6]))).rejects.toThrow(
            /gzip corrupto/,
        );
        await expect(
            detectarArchivo(await comprimir(new TextEncoder().encode("esto no es un contenedor"))),
        ).rejects.toThrow(/cabecera/);
        await expect(detectarArchivo(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]))).rejects.toThrow(/zip/);

        const dir = mkdtempSync(join(tmpdir(), "opios-detect-"));
        try {
            const ruta = join(dir, "banco.db");
            abrirDb(ruta).close();
            const bytes = new Uint8Array(await Bun.file(ruta).arrayBuffer());
            const r = await detectarArchivo(bytes);
            expect(r.tipo).toBe("sqlite");
            expect(r.sqlite).toBe(bytes);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }

        await expect(detectarArchivo(new TextEncoder().encode("hola"))).rejects.toThrow(/No se reconoce/);
        await expect(detectarArchivo(new Uint8Array(3))).rejects.toThrow(/demasiado corto/);
        await expect(detectarArchivo(null)).rejects.toThrow(/demasiado corto/);
    });
});
