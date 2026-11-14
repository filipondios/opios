import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "../config.js";
import { migrar, tieneFts5 } from "./esquema.js";
import { crearPreguntas } from "./preguntas.js";
import { crearProgreso } from "./progreso.js";
import { crearSimulacros } from "./simulacros.js";
import { crearTemario } from "./temario.js";

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

function abrirRepo(db) {
    db.run("PRAGMA journal_mode = WAL");
    /* Con WAL, NORMAL es lo habitual: suficiente consistencia y menos esperas al escribir. */
    db.run("PRAGMA synchronous = NORMAL");
    /* Otra conexión (el servidor, `bun run seed`, `backup`, `ids`) no debe provocar un fallo
       inmediato: se espera hasta 5 s antes de rendirse con SQLITE_BUSY (Fase 2.1). */
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA foreign_keys = ON");
    migrar(db);
    const ftsDisponible = tieneFts5(db);

    const q = {
        temaPorId: db.query("SELECT id FROM temas WHERE id = ?"),
        temaPorBloqueNumero: db.query("SELECT id FROM temas WHERE bloque_id = ? AND numero = ?"),
        insertarTema: db.query("INSERT INTO temas (bloque_id, numero, nombre) VALUES (?, ?, ?)"),
        porClaveNorm: db.query("SELECT id, tema_id AS tema FROM preguntas WHERE clave_norm = ?"),
        porIdExterno: db.query("SELECT id, tema_id AS tema FROM preguntas WHERE id_externo = ?"),
        insertarPregunta: db.query(
            "INSERT INTO preguntas (tema_id, enunciado, clave_norm, explicacion, id_externo) VALUES (?, ?, ?, ?, ?)",
        ),
        actualizarPregunta: db.query(
            "UPDATE preguntas SET tema_id = ?, enunciado = ?, clave_norm = ?, explicacion = ?, id_externo = ?, modificada = datetime('now') WHERE id = ?",
        ),
        insertarOpcion: db.query(
            "INSERT INTO opciones (pregunta_id, posicion, texto, es_correcta) VALUES (?, ?, ?, ?)",
        ),
        borrarOpciones: db.query("DELETE FROM opciones WHERE pregunta_id = ?"),
        borrarPregunta: db.query("DELETE FROM preguntas WHERE id = ?"),
        contar: db.query("SELECT COUNT(*) AS n FROM preguntas"),
        upsertProgreso: db.query(`
      INSERT INTO progreso (pregunta_id, caja, vence, aciertos, fallos)
      SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM preguntas WHERE id = ?1)
      ON CONFLICT (pregunta_id) DO UPDATE SET
        caja = excluded.caja, vence = excluded.vence, aciertos = excluded.aciertos,
        fallos = excluded.fallos, actualizado = datetime('now')`),
        /* Igual que `upsertProgreso`, pero los contadores son incrementos (Fase 2.8): dos
           pestañas con datos viejos suman sus aciertos/fallos en vez de pisarse. */
        sumarProgreso: db.query(`
      INSERT INTO progreso (pregunta_id, caja, vence, aciertos, fallos)
      SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM preguntas WHERE id = ?1)
      ON CONFLICT (pregunta_id) DO UPDATE SET
        caja = excluded.caja, vence = excluded.vence,
        aciertos = aciertos + excluded.aciertos, fallos = fallos + excluded.fallos,
        actualizado = datetime('now')`),
        /* Un fallo de simulacro baja 2 cajas (mínimo 1) y deja la pregunta vencida hoy. */
        falloSimulacro: db.query(`
      INSERT INTO progreso (pregunta_id, caja, vence, aciertos, fallos)
      VALUES (?1, 1, ?2, 0, 1)
      ON CONFLICT (pregunta_id) DO UPDATE SET
        caja = MAX(1, caja - 2), vence = excluded.vence,
        fallos = fallos + 1, actualizado = datetime('now')`),
        /* Un acierto de simulacro solo suma al contador; no mueve caja ni fecha. */
        aciertoSimulacro: db.query(`
      UPDATE progreso SET aciertos = aciertos + 1, actualizado = datetime('now')
      WHERE pregunta_id = ?`),
        borrarProgreso: db.query("DELETE FROM progreso"),
        /* Registra una respuesta solo si la pregunta existe (si no, 0 filas). */
        insertarRespuesta: db.query(`
      INSERT INTO respuestas (pregunta_id, fecha, acierto, origen, ms)
      SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM preguntas WHERE id = ?1)`),
    };

    const { repo: temario, ayudas } = crearTemario({ db, q });
    const preguntas = crearPreguntas({ db, q, ftsDisponible, ...ayudas });
    const progreso = crearProgreso({ db, q });
    const simulacros = crearSimulacros({ db, q });

    return {
        db,
        close: () => db.close(),
        ...preguntas,
        ...progreso,
        ...temario,
        ...simulacros,
    };
}
