/* Verificación única de bancos Opios (F2.4) sobre una conexión ya abierta: íntegra, con
   esquema conocido (no futuro), sus tablas obligatorias y sin referencias rotas. Neutra de
   plataforma: la usan igual bun:sqlite (PC/servidor) que el adaptador WASM (Android), en
   todos los caminos de import/restore/update. Vive fuera de esquema.js para que el núcleo
   de UI no arrastre nada más. */
import { MIGRACIONES } from "./esquema.js";

const TABLAS = ["preguntas", "opciones", "progreso", "temas"];

/** Comprueba que la conexión es un banco Opios usable. Devuelve { user_version, preguntas };
    lanza con un error claro si no. */
export function verificarBanco(db) {
    const integridad = db.query("PRAGMA integrity_check").get()?.integrity_check;
    if (integridad !== "ok") throw new Error(`La SQLite está dañada: ${integridad ?? "sin respuesta"}`);
    const user_version = db.query("PRAGMA user_version").get().user_version;
    if (user_version > MIGRACIONES.length)
        throw new Error(
            `Esquema futuro no compatible: v${user_version} y esta versión solo conoce hasta v${MIGRACIONES.length}.`,
        );
    const tablas = new Set(
        db
            .query("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all()
            .map((t) => t.name),
    );
    for (const tabla of TABLAS)
        if (!tablas.has(tabla)) throw new Error(`No es un banco Opios: falta la tabla «${tabla}».`);
    const rotas = db.query("PRAGMA foreign_key_check").all();
    if (rotas.length) throw new Error(`La SQLite tiene ${rotas.length} referencia(s) rota(s) (foreign_key_check).`);
    return { user_version, preguntas: db.query("SELECT COUNT(*) AS n FROM preguntas").get().n };
}

/** Reenvía mis errores claros y contextualiza los que vienen de SQLite. */
export function errorDeVerificacion(e, contexto) {
    if (/Esquema futuro|No es un banco Opios|está dañada|referencias rotas/.test(e.message)) return e;
    return new Error(`No se pudo leer como banco Opios${contexto ? ` (${contexto})` : ""}: ${e.message}`);
}
