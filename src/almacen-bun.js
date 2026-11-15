/* Almacén con el sistema de archivos de Bun/Node (F2.1): PC, servidor y CLI. */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const almacenBun = {
    existe: async (ruta) => existsSync(ruta),
    leer: async (ruta) => new Uint8Array(readFileSync(ruta)),
    escribir: async (ruta, bytes) => {
        mkdirSync(dirname(ruta), { recursive: true });
        writeFileSync(ruta, bytes);
    },
    renombrar: async (de, a) => {
        mkdirSync(dirname(a), { recursive: true });
        renameSync(de, a);
    },
    borrar: async (ruta) => rmSync(ruta, { force: true }),
    listar: async (dir) => (existsSync(dir) ? readdirSync(dir) : []),
};
