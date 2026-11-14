/* Validación de archivos SQLite (banco portable / biblioteca). Solo servidor: usa la
    conexión de Bun. Vive fuera de esquema.js para que el bundle del navegador (task 11)
    no arrastre `bun:sqlite`. */
import { Database } from "bun:sqlite";
import { MIGRACIONES } from "./esquema.js";

/** Comprueba que un archivo SQLite es un banco Opios usable: íntegro, con esquema conocido
    (no futuro) y sus tablas. Devuelve { user_version, preguntas }; lanza con error claro si no. */
export function validarBancoSqlite(ruta) {
    let db;
    try {
        db = new Database(ruta, { readonly: true, strict: true });
        const integridad = db.query("PRAGMA integrity_check").get()?.integrity_check;
        if (integridad !== "ok") throw new Error(`La SQLite está dañada (${ruta}): ${integridad ?? "sin respuesta"}`);
        const user_version = db.query("PRAGMA user_version").get().user_version;
        if (user_version > MIGRACIONES.length)
            throw new Error(
                `Esquema futuro no compatible: v${user_version} y esta versión solo conoce hasta v${MIGRACIONES.length}.`,
            );
        const tablas = new Set(
            db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name),
        );
        for (const tabla of ["preguntas", "opciones", "progreso", "temas"])
            if (!tablas.has(tabla)) throw new Error(`No es un banco Opios: falta la tabla «${tabla}».`);
        const preguntas = db.query("SELECT COUNT(*) AS n FROM preguntas").get().n;
        return { user_version, preguntas };
    } catch (e) {
        /* Mis errores ya son claros; los que vienen de SQLite se contextualizan. */
        if (/Esquema futuro|No es un banco Opios|está dañada/.test(e.message)) throw e;
        throw new Error(`No se pudo leer como banco Opios (${ruta}): ${e.message}`);
    } finally {
        db?.close();
    }
}
