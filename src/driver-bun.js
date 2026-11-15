/* Driver SQLite sobre bun:sqlite (F2.2): PC, servidor y CLI. Abre por ruta; la instantánea
   usa `VACUUM INTO` (copia consistente y compacta, ver backup.js). */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copiaSeguridad } from "./backup.js";
import { integridad, userVersion } from "./driver.js";

export const driverBun = {
    async abrir(almacen, ruta, { readonly = false } = {}) {
        if (readonly && !(await almacen.existe(ruta))) throw new Error(`No existe el banco «${ruta}».`);
        return new Database(ruta, { create: !readonly, strict: true, readonly });
    },
    instantanea(db) {
        const dir = mkdtempSync(join(tmpdir(), "opios-instantanea-"));
        try {
            const destino = join(dir, "copia.db");
            copiaSeguridad(db, destino);
            return new Uint8Array(readFileSync(destino));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    },
    userVersion,
    integridad,
    /* bun:sqlite escribe en el archivo al momento: no hace falta volcar el catálogo. */
    soloMemoria: false,
};
