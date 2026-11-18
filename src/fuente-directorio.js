/* Fuente de banco en un directorio real (F2.6): PC, servidor y CLI. El contrato vive en
   fuente.js; aquí solo la versión node:fs. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export function fuenteDirectorio(raiz) {
    return {
        listar: (dir = "") => readdir(join(raiz, dir)),
        leerTexto: (ruta) => readFile(join(raiz, ruta), "utf8"),
    };
}
