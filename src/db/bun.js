/* Conexión SQLite con Bun. Solo el servidor y los scripts CLI la usan; el núcleo
   (abrirRepo y todo src/db/*.js) es independiente del driver (task 11). */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "../config-servidor.js";
import { abrirRepo } from "./index.js";

/** Abre (y crea/migra si hace falta) la base de datos y devuelve las operaciones que usa la app.
    `crear` permite inyectar la conexión (solo para probar el cierre en caso de fallo). */
export function abrirDb(ruta = DB_PATH, crear = (r) => new Database(r, { create: true, strict: true })) {
    if (ruta !== ":memory:") mkdirSync(dirname(ruta), { recursive: true });
    const db = crear(ruta);
    try {
        return abrirRepo(db);
    } catch (e) {
        /* Una conexión a medio configurar no debe quedarse abierta: bloquearía la siguiente apertura. */
        try {
            db.close();
        } catch {
            /* ya estaba cerrada */
        }
        throw e;
    }
}
