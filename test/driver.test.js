/* F2.2: contrato del driver SQLite (abrir/instantanea/userVersion/integridad) en sus dos
   implementaciones: bun:sqlite (PC/servidor) y sql.js (WebView de Android). */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crearAlmacenMemoria } from "../src/almacen-memoria.js";
import { abrirRepo } from "../src/db/index.js";
import { MIGRACIONES } from "../src/db/esquema.js";
import { comprobarDriver, integridad, userVersion } from "../src/driver.js";
import { driverBun } from "../src/driver-bun.js";
import { crearDriverWasm } from "../src/driver-wasm.js";

const WASM = "node_modules/sql.js/dist/sql-wasm.wasm";
const driverWasm = crearDriverWasm({ rutaWasm: WASM });

const contextos = [
    [
        "Bun (bun:sqlite)",
        () => {
            const dir = mkdtempSync(join(tmpdir(), "opios-driver-bun-"));
            return {
                driver: driverBun,
                almacen: crearAlmacenMemoria(),
                ruta: join(dir, "banco.db"),
                guardar: (ruta, bytes) => writeFileSync(ruta, bytes),
                limpiar: () => rmSync(dir, { recursive: true, force: true }),
            };
        },
    ],
    [
        "WASM (sql.js)",
        () => {
            const almacen = crearAlmacenMemoria();
            return {
                driver: driverWasm,
                almacen,
                ruta: "banco/banco.db",
                guardar: (ruta, bytes) => almacen.escribir(ruta, bytes),
                limpiar: () => {},
            };
        },
    ],
];

describe("driver SQLite (F2.2)", () => {
    for (const [nombre, preparar] of contextos) {
        describe(nombre, () => {
            test("implementa el contrato completo", () => {
                const ctx = preparar();
                try {
                    expect(() => comprobarDriver(ctx.driver)).not.toThrow();
                } finally {
                    ctx.limpiar();
                }
            });

            test("abrir crea o migra el banco y expone versión e integridad", async () => {
                const ctx = preparar();
                try {
                    const repo = abrirRepo(await ctx.driver.abrir(ctx.almacen, ctx.ruta));
                    expect(userVersion(repo.db)).toBe(MIGRACIONES.length);
                    expect(integridad(repo.db)).toBe("ok");
                    repo.close();
                } finally {
                    ctx.limpiar();
                }
            });

            test("instantanea son bytes consistentes que se vuelven a abrir", async () => {
                const ctx = preparar();
                try {
                    const repo = abrirRepo(await ctx.driver.abrir(ctx.almacen, ctx.ruta));
                    const bloque = repo.crearBloque({ nombre: "Bloque copia" });
                    const tema = repo.crearTema({ bloque: bloque.id, numero: 1, nombre: "Tema" });
                    repo.crear({
                        tema: tema.id,
                        pregunta: "¿Copiada?",
                        respuestas: ["sí", "no"],
                        correcta: 0,
                        explicacion: "",
                    });
                    const bytes = ctx.driver.instantanea(repo.db);
                    repo.close();

                    expect(Buffer.from(bytes.subarray(0, 15)).toString()).toBe("SQLite format 3");
                    const ruta2 = ctx.ruta + ".copia";
                    await ctx.guardar(ruta2, bytes);
                    const repo2 = abrirRepo(await ctx.driver.abrir(ctx.almacen, ruta2));
                    expect(repo2.contarPreguntas()).toBe(1);
                    expect(repo2.listar({ texto: "Copiada" }).total).toBe(1);
                    repo2.close();
                } finally {
                    ctx.limpiar();
                }
            });

            test("abrir en readonly sobre un banco inexistente lanza", async () => {
                const ctx = preparar();
                try {
                    await expect(ctx.driver.abrir(ctx.almacen, ctx.ruta, { readonly: true })).rejects.toThrow();
                } finally {
                    ctx.limpiar();
                }
            });
        });
    }

    test("comprobarDriver rechaza un driver incompleto", () => {
        expect(() => comprobarDriver({ abrir: () => {} })).toThrow(/instantanea|integridad|userVersion/);
    });
});
