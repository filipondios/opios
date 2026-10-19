import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./config.js";
import { ErrorApi } from "./errores.js";
import { claveDe } from "./validar.js";

/* ------------------------------------------------------------------
   Esquema. Cada JSON de pregunta se descompone en:
     preguntas (enunciado, explicación, tema)  1 ── N  opciones (texto, posición, ¿correcta?)
   y el progreso del repaso espaciado vive en `progreso`, una fila por pregunta
   (antes: id -> [caja, vence, aciertos, fallos] en localStorage).
   ------------------------------------------------------------------ */
const MIGRACIONES = [
  /* v1 */ `
  CREATE TABLE temas (
    id     INTEGER PRIMARY KEY CHECK (id >= 0),
    nombre TEXT
  );

  CREATE TABLE preguntas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tema_id     INTEGER NOT NULL REFERENCES temas(id) ON UPDATE CASCADE,
    enunciado   TEXT    NOT NULL CHECK (length(trim(enunciado)) > 0),
    clave       TEXT    NOT NULL UNIQUE,            -- enunciado sin espacios repetidos: evita duplicados
    explicacion TEXT    NOT NULL DEFAULT '',
    creada      TEXT    NOT NULL DEFAULT (datetime('now')),
    modificada  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_preguntas_tema ON preguntas(tema_id);

  CREATE TABLE opciones (
    id          INTEGER PRIMARY KEY,
    pregunta_id INTEGER NOT NULL REFERENCES preguntas(id) ON DELETE CASCADE,
    posicion    INTEGER NOT NULL CHECK (posicion >= 0),   -- 0 = A, 1 = B...
    texto       TEXT    NOT NULL CHECK (length(trim(texto)) > 0),
    es_correcta INTEGER NOT NULL DEFAULT 0 CHECK (es_correcta IN (0, 1)),
    UNIQUE (pregunta_id, posicion)
  );
  -- como mucho una opción correcta por pregunta (que haya al menos una lo garantiza la capa de datos)
  CREATE UNIQUE INDEX ux_opcion_correcta ON opciones(pregunta_id) WHERE es_correcta = 1;

  CREATE TABLE progreso (
    pregunta_id INTEGER PRIMARY KEY REFERENCES preguntas(id) ON DELETE CASCADE,
    caja        INTEGER NOT NULL DEFAULT 0 CHECK (caja BETWEEN 0 AND 6),
    vence       TEXT    NOT NULL CHECK (vence GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    aciertos    INTEGER NOT NULL DEFAULT 0 CHECK (aciertos >= 0),
    fallos      INTEGER NOT NULL DEFAULT 0 CHECK (fallos >= 0),
    actualizado TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_progreso_vence ON progreso(vence);
  `,
];

function migrar(db) {
  const actual = db.query("PRAGMA user_version").get().user_version;
  for (let v = actual; v < MIGRACIONES.length; v++) {
    db.transaction(() => {
      db.run(MIGRACIONES[v]);
      db.run(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}

const marcas = (n) => Array(n).fill("?").join(",");

/** Abre (y crea/migra si hace falta) la base de datos y devuelve las operaciones que usa la app. */
export function abrirDb(ruta = DB_PATH) {
  if (ruta !== ":memory:") mkdirSync(dirname(ruta), { recursive: true });
  const db = new Database(ruta, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  migrar(db);

  const q = {
    asegurarTema: db.query("INSERT OR IGNORE INTO temas (id) VALUES (?)"),
    porClave: db.query("SELECT id, tema_id AS tema FROM preguntas WHERE clave = ?"),
    insertarPregunta: db.query("INSERT INTO preguntas (tema_id, enunciado, clave, explicacion) VALUES (?, ?, ?, ?)"),
    actualizarPregunta: db.query(
      "UPDATE preguntas SET tema_id = ?, enunciado = ?, clave = ?, explicacion = ?, modificada = datetime('now') WHERE id = ?"),
    insertarOpcion: db.query("INSERT INTO opciones (pregunta_id, posicion, texto, es_correcta) VALUES (?, ?, ?, ?)"),
    borrarOpciones: db.query("DELETE FROM opciones WHERE pregunta_id = ?"),
    borrarPregunta: db.query("DELETE FROM preguntas WHERE id = ?"),
    contar: db.query("SELECT COUNT(*) AS n FROM preguntas"),
    upsertProgreso: db.query(`
      INSERT INTO progreso (pregunta_id, caja, vence, aciertos, fallos)
      SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM preguntas WHERE id = ?1)
      ON CONFLICT (pregunta_id) DO UPDATE SET
        caja = excluded.caja, vence = excluded.vence, aciertos = excluded.aciertos,
        fallos = excluded.fallos, actualizado = datetime('now')`),
    borrarProgreso: db.query("DELETE FROM progreso"),
  };

  /* Une filas de preguntas con sus opciones (ya ordenadas por pregunta y posición). */
  function ensamblar(filasPreguntas, filasOpciones) {
    const porId = new Map();
    for (const p of filasPreguntas) {
      porId.set(p.id, { id: p.id, tema: p.tema, pregunta: p.enunciado, respuestas: [], correcta: 0, explicacion: p.explicacion });
    }
    for (const o of filasOpciones) {
      const p = porId.get(o.pregunta_id);
      if (!p) continue;
      p.respuestas.push(o.texto);
      if (o.es_correcta) p.correcta = o.posicion;
    }
    return [...porId.values()];
  }

  function opcionesDe(ids) {
    if (!ids.length) return [];
    return db.query(
      `SELECT pregunta_id, posicion, texto, es_correcta FROM opciones
       WHERE pregunta_id IN (${marcas(ids.length)}) ORDER BY pregunta_id, posicion`).all(...ids);
  }

  /* Inserta o actualiza una pregunta con sus opciones. Debe llamarse dentro de una transacción. */
  function guardar(id, v) {
    const clave = claveDe(v.pregunta);
    const otra = q.porClave.get(clave);
    if (otra && otra.id !== id) {
      throw new ErrorApi(409, `Ya hay una pregunta con este mismo enunciado (nº ${otra.id}, tema ${otra.tema}).`, { existente: { id: otra.id, tema: otra.tema } });
    }
    q.asegurarTema.run(v.tema);
    if (id == null) {
      id = Number(q.insertarPregunta.run(v.tema, v.pregunta, clave, v.explicacion).lastInsertRowid);
    } else {
      q.actualizarPregunta.run(v.tema, v.pregunta, clave, v.explicacion, id);
      q.borrarOpciones.run(id);
    }
    v.respuestas.forEach((texto, k) => q.insertarOpcion.run(id, k, texto, k === v.correcta ? 1 : 0));
    return id;
  }

  const repo = {
    db,
    close: () => db.close(),

    contarPreguntas: () => q.contar.get().n,

    /** Resumen por tema para la pantalla de selección. `hoy` = AAAA-MM-DD. */
    estadisticasTemas(hoy, cajaDominada) {
      return db.query(`
        SELECT p.tema_id AS tema, t.nombre, COUNT(*) AS total,
               COALESCE(SUM(pr.pregunta_id IS NULL), 0) AS nuevas,
               COALESCE(SUM(pr.vence <= ?), 0)          AS repaso,
               COALESCE(SUM(pr.caja >= ?), 0)           AS dominadas,
               COALESCE(SUM(pr.caja < ?), 0)            AS aprendiendo
        FROM preguntas p
        JOIN temas t ON t.id = p.tema_id
        LEFT JOIN progreso pr ON pr.pregunta_id = p.id
        GROUP BY p.tema_id ORDER BY p.tema_id`).all(hoy, cajaDominada, cajaDominada);
    },

    /** Preguntas (con opciones) de los temas dados, más el progreso de esas preguntas. */
    paraTest(temas) {
      if (!temas.length) return { preguntas: [], progreso: {} };
      const preguntas = ensamblar(
        db.query(`SELECT id, tema_id AS tema, enunciado, explicacion FROM preguntas
                  WHERE tema_id IN (${marcas(temas.length)}) ORDER BY id`).all(...temas),
        db.query(`SELECT o.pregunta_id, o.posicion, o.texto, o.es_correcta FROM opciones o
                  JOIN preguntas p ON p.id = o.pregunta_id
                  WHERE p.tema_id IN (${marcas(temas.length)}) ORDER BY o.pregunta_id, o.posicion`).all(...temas));
      const progreso = {};
      const filas = db.query(
        `SELECT pr.pregunta_id AS id, pr.caja, pr.vence, pr.aciertos, pr.fallos FROM progreso pr
         JOIN preguntas p ON p.id = pr.pregunta_id WHERE p.tema_id IN (${marcas(temas.length)})`).all(...temas);
      for (const f of filas) progreso[f.id] = [f.caja, f.vence, f.aciertos, f.fallos];
      return { preguntas, progreso };
    },

    guardarProgreso: db.transaction((entradas) => {
      for (const e of entradas) q.upsertProgreso.run(e.id, e.caja, e.vence, e.aciertos, e.fallos);
    }),
    reiniciarProgreso: () => { q.borrarProgreso.run(); },

    /** Listado paginado del creador, con filtro por tema y búsqueda en el enunciado.
        La búsqueda se hace en JS porque lower() de SQLite solo entiende ASCII (acentos y mayúsculas como «Ú»). */
    listar({ tema = null, texto = "", limite = 50, desde = 0 } = {}) {
      const cond = tema !== null ? "WHERE tema_id = ?" : "";
      const args = tema !== null ? [tema] : [];
      let ids;
      if (texto) {
        const buscado = texto.toLowerCase();
        ids = db.query(`SELECT id, enunciado FROM preguntas ${cond} ORDER BY id DESC`).all(...args)
          .filter((f) => f.enunciado.toLowerCase().includes(buscado)).map((f) => f.id);
      } else {
        ids = db.query(`SELECT id FROM preguntas ${cond} ORDER BY id DESC`).all(...args).map((f) => f.id);
      }
      const pagina = ids.slice(desde, desde + limite);
      if (!pagina.length) return { total: ids.length, items: [] };
      const filas = db.query(
        `SELECT id, tema_id AS tema, enunciado, explicacion FROM preguntas WHERE id IN (${marcas(pagina.length)})`).all(...pagina);
      const orden = new Map(pagina.map((id, i) => [id, i]));
      filas.sort((x, y) => orden.get(x.id) - orden.get(y.id));
      return { total: ids.length, items: ensamblar(filas, opcionesDe(pagina)) };
    },

    obtener(id) {
      const fila = db.query("SELECT id, tema_id AS tema, enunciado, explicacion FROM preguntas WHERE id = ?").get(id);
      return fila ? ensamblar([fila], opcionesDe([id]))[0] : null;
    },

    crear: db.transaction((v) => guardar(null, v)),

    actualizar: db.transaction((id, v) => {
      if (!db.query("SELECT 1 FROM preguntas WHERE id = ?").get(id)) return false;
      guardar(id, v);
      return true;
    }),

    borrar: (id) => q.borrarPregunta.run(id).changes > 0,

    /** Todas las preguntas en el formato JSON antiguo (copia de seguridad). */
    todas() {
      const filas = db.query("SELECT id, tema_id AS tema, enunciado, explicacion FROM preguntas ORDER BY tema_id, id").all();
      const ops = db.query("SELECT pregunta_id, posicion, texto, es_correcta FROM opciones ORDER BY pregunta_id, posicion").all();
      return ensamblar(filas, ops);
    },

    /** Importa preguntas ya validadas; las que ya existen (mismo enunciado) se omiten. */
    importar: db.transaction((lista) => {
      let nuevas = 0, duplicadas = 0;
      for (const v of lista) {
        if (q.porClave.get(claveDe(v.pregunta))) { duplicadas++; continue; }
        guardar(null, v); nuevas++;
      }
      return { nuevas, duplicadas };
    }),
  };
  return repo;
}
