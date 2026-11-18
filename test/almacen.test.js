/* F2.1: contrato del almacén de archivos y sus tres implementaciones (node:fs, Filesystem
   de Capacitor y memoria). Las tres deben comportarse igual: mismas rutas, mismos bytes. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { comprobarAlmacen } from "../src/almacen.js";
import { almacenBun } from "../src/almacen-bun.js";
import { crearAlmacenCapacitor } from "../src/almacen-capacitor.js";
import { crearAlmacenMemoria } from "../src/almacen-memoria.js";

/* Filesystem de Capacitor mínimo en memoria. Trabaja en base64, como el real. */
function fakeFilesystem() {
    const archivos = new Map();
    const clave = ({ path, directory }) => `${directory}/${path}`;
    return {
        stat: async (o) => {
            if (!archivos.has(clave(o))) throw new Error("no existe");
            return { size: archivos.get(clave(o)).length };
        },
        readFile: async (o) => ({ data: Buffer.from(archivos.get(clave(o))).toString("base64") }),
        writeFile: async (o) => {
            archivos.set(clave(o), new Uint8Array(Buffer.from(o.data, "base64")));
        },
        rename: async ({ from, to, directory }) => {
            const bytes = archivos.get(`${directory}/${from}`);
            if (bytes === undefined) throw new Error("no existe");
            archivos.set(`${directory}/${to}`, bytes);
            archivos.delete(`${directory}/${from}`);
        },
        deleteFile: async (o) => {
            archivos.delete(clave(o));
        },
        readdir: async (o) => {
            const prefijo = `${o.directory}/${o.path}/`;
            return {
                files: [...archivos.keys()]
                    .filter((k) => k.startsWith(prefijo))
                    .map((k) => ({ name: k.slice(prefijo.length) })),
            };
        },
    };
}

/* Cada implementación recibe una carpeta base y ofrece `limpiar`. */
const implementaciones = [
    [
        "Bun (node:fs)",
        () => {
            const dir = mkdtempSync(join(tmpdir(), "opios-almacen-"));
            return {
                almacen: almacenBun,
                dir: join(dir, "datos"),
                limpiar: () => rmSync(dir, { recursive: true, force: true }),
            };
        },
    ],
    ["memoria", () => ({ almacen: crearAlmacenMemoria(), dir: "datos", limpiar: () => {} })],
    [
        "Capacitor (Filesystem inyectado)",
        () => ({ almacen: crearAlmacenCapacitor(fakeFilesystem(), "DATA"), dir: "datos", limpiar: () => {} }),
    ],
];

describe("almacén de archivos (F2.1)", () => {
    for (const [nombre, preparar] of implementaciones) {
        describe(nombre, () => {
            test("implementa el contrato completo", () => {
                const { almacen, limpiar } = preparar();
                try {
                    expect(() => comprobarAlmacen(almacen)).not.toThrow();
                } finally {
                    limpiar();
                }
            });

            test("escribir, leer, renombrar, borrar y listar", async () => {
                const { almacen, dir, limpiar } = preparar();
                try {
                    const a = join(dir, "a.bin");
                    const b = join(dir, "b.bin");
                    expect(await almacen.existe(a)).toBe(false);
                    await almacen.escribir(a, new Uint8Array([1, 2, 3]));
                    expect(await almacen.existe(a)).toBe(true);
                    expect([...(await almacen.leer(a))]).toEqual([1, 2, 3]);

                    await almacen.renombrar(a, b);
                    expect(await almacen.existe(a)).toBe(false);
                    expect([...(await almacen.leer(b))]).toEqual([1, 2, 3]);
                    expect(await almacen.listar(dir)).toEqual(["b.bin"]);

                    await almacen.borrar(b);
                    expect(await almacen.existe(b)).toBe(false);
                    await almacen.borrar(b); // borrar lo que no existe no falla
                } finally {
                    limpiar();
                }
            });

            test("leer un archivo que no existe lanza; listar un directorio vacío devuelve []", async () => {
                const { almacen, dir, limpiar } = preparar();
                try {
                    await expect(almacen.leer(join(dir, "no.bin"))).rejects.toThrow();
                    expect(await almacen.listar(join(dir, "vacio"))).toEqual([]);
                } finally {
                    limpiar();
                }
            });
        });
    }

    test("comprobarAlmacen rechaza un almacén incompleto", () => {
        expect(() => comprobarAlmacen({ existe: () => {} })).toThrow(/renombrar|listar|leer|escribir/);
    });
});
