import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./config.js";
import { ErrorApi } from "./errores.js";
import { claveDe } from "./validar.js";

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

  /* v2: bloques del temario y numeración de temas dentro de cada bloque. */
  /* v2 */ `
  CREATE TABLE bloques (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT    NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(nombre)) > 0),
    orden  INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO bloques (id, nombre, orden) VALUES (1, 'Bloque 1', 0);

  -- Los temas existentes pasan al primer bloque; su número dentro del bloque es el id actual.
  ALTER TABLE temas ADD COLUMN bloque_id INTEGER REFERENCES bloques(id);
  ALTER TABLE temas ADD COLUMN numero INTEGER;
  UPDATE temas SET bloque_id = 1, numero = id;

  CREATE UNIQUE INDEX ux_temas_bloque_numero ON temas(bloque_id, numero);
  CREATE INDEX idx_temas_bloque ON temas(bloque_id);
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
    temaPorId: db.query("SELECT id FROM temas WHERE id = ?"),
    temaPorBloqueNumero: db.query("SELECT id FROM temas WHERE bloque_id = ? AND numero = ?"),
    maxNumeroTema: db.query("SELECT COALESCE(MAX(numero), -1) AS n FROM temas WHERE bloque_id = ?"),
    insertarTema: db.query("INSERT INTO temas (id, bloque_id, numero, nombre) VALUES (?, ?, ?, ?)"),
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

  /* Une filas de preguntas con sus opciones y los datos de su tema/bloque. */
  function ensamblar(filasPreguntas, filasOpciones) {
    const porId = new Map();
    for (const p of filasPreguntas) {
      porId.set(p.id, {
        id: p.id, tema: p.tema,
        tema_numero: p.tema_numero ?? p.tema,
        tema_nombre: p.tema_nombre ?? null,
        bloque: p.bloque ?? null,
        bloque_nombre: p.bloque_nombre ?? "Sin bloque",
        pregunta: p.enunciado, respuestas: [], correcta: 0, explicacion: p.explicacion,
      });
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

  /* Primer bloque por orden, o uno nuevo si aún no hay ninguno. */
  function bloquePorDefecto() {
    const b = db.query("SELECT id FROM bloques ORDER BY orden, id LIMIT 1").get();
    if (b) return b.id;
    return Number(db.query("INSERT INTO bloques (nombre, orden) VALUES ('Bloque 1', 0)").run().lastInsertRowid);
  }

  /* Id del bloque con ese nombre; si no existe, se crea al final. */
  function bloquePorNombre(nombre) {
    const b = db.query("SELECT id FROM bloques WHERE nombre = ?").get(nombre);
    if (b) return b.id;
    const orden = db.query("SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM bloques").get().n;
    return Number(db.query("INSERT INTO bloques (nombre, orden) VALUES (?, ?)").run(nombre, orden).lastInsertRowid);
  }

  /* Número libre dentro de un bloque: el preferido si está libre, si no el siguiente. */
  function numeroLibre(bloque, preferido) {
    if (!q.temaPorBloqueNumero.get(bloque, preferido)) return preferido;
    return q.maxNumeroTema.get(bloque).n + 1;
  }

  /* Garantiza que existe el tema con ese id (datos antiguos sin bloque). */
  function asegurarTema(tema) {
    if (q.temaPorId.get(tema)) return tema;
    const bloque = bloquePorDefecto();
    q.insertarTema.run(tema, bloque, numeroLibre(bloque, tema), null);
    return tema;
  }

  /* Garantiza que existe el tema `numero` dentro del bloque `nombre` y devuelve su id. */
  function asegurarTemaEnBloque(nombre, numero) {
    const bloque = bloquePorNombre(nombre);
    const existente = q.temaPorBloqueNumero.get(bloque, numero);
    if (existente) return existente.id;
    return Number(q.insertarTema.run(null, bloque, numero, null).lastInsertRowid);
  }

  /* Inserta o actualiza una pregunta con sus opciones. Debe llamarse dentro de una transacción. */
  function guardar(id, v) {
    const clave = claveDe(v.pregunta);
    const otra = q.porClave.get(clave);
    if (otra && otra.id !== id) {
      throw new ErrorApi(409, `Ya hay una pregunta con este mismo enunciado (nº ${otra.id}, tema ${otra.tema}).`, { existente: { id: otra.id, tema: otra.tema } });
    }
    const tema = v.bloque
      ? asegurarTemaEnBloque(v.bloque, v.tema_numero ?? v.tema)
      : asegurarTema(v.tema);
    if (id == null) {
      id = Number(q.insertarPregunta.run(tema, v.pregunta, clave, v.explicacion).lastInsertRowid);
    } else {
      q.actualizarPregunta.run(tema, v.pregunta, clave, v.explicacion, id);
      q.borrarOpciones.run(id);
    }
    v.respuestas.forEach((texto, k) => q.insertarOpcion.run(id, k, texto, k === v.correcta ? 1 : 0));
    return id;
  }

  /* Consulta base que añade el tema y el bloque a cada pregunta. */
  const CAMPOS_PREGUNTA = `
    p.id, p.tema_id AS tema, t.numero AS tema_numero, t.nombre AS tema_nombre,
    t.bloque_id AS bloque, b.nombre AS bloque_nombre, p.enunciado, p.explicacion`;
  const JOINS_PREGUNTA = `
    FROM preguntas p
    JOIN temas t ON t.id = p.tema_id
    LEFT JOIN bloques b ON b.id = t.bloque_id`;

  /* Un tema con su número de preguntas, tal y como lo usa la página de temario. */
  function temaConPreguntas(id) {
    return db.query(`
      SELECT t.id, t.bloque_id AS bloque, t.numero, t.nombre, COUNT(p.id) AS preguntas
      FROM temas t LEFT JOIN preguntas p ON p.tema_id = t.id
      WHERE t.id = ? GROUP BY t.id`).get(id) ?? null;
  }

  const repo = {
    db,
    close: () => db.close(),

    contarPreguntas: () => q.contar.get().n,

    /** Resumen por tema (agrupado por bloque) para la pantalla de selección. `hoy` = AAAA-MM-DD. */
    estadisticasTemas(hoy, cajaDominada) {
      return db.query(`
        SELECT p.tema_id AS tema, t.numero AS tema_numero, t.nombre AS tema_nombre,
               t.bloque_id AS bloque, b.nombre AS bloque_nombre,
               COALESCE(b.orden, 2147483647) AS bloque_orden, COUNT(*) AS total,
               COALESCE(SUM(pr.pregunta_id IS NULL), 0) AS nuevas,
               COALESCE(SUM(pr.vence <= ?), 0)          AS repaso,
               COALESCE(SUM(pr.caja >= ?), 0)           AS dominadas,
               COALESCE(SUM(pr.caja < ?), 0)            AS aprendiendo
        FROM preguntas p
        JOIN temas t ON t.id = p.tema_id
        LEFT JOIN bloques b ON b.id = t.bloque_id
        LEFT JOIN progreso pr ON pr.pregunta_id = p.id
        GROUP BY p.tema_id
        ORDER BY COALESCE(b.orden, 2147483647), COALESCE(t.numero, t.id), p.tema_id`).all(hoy, cajaDominada, cajaDominada);
    },

    /** Bloques ordenados con sus temas (numerados dentro del bloque) y el número de preguntas de cada tema. */
    temario() {
      const bloques = db.query("SELECT id, nombre, orden FROM bloques ORDER BY orden, id").all()
        .map((b) => ({ id: b.id, nombre: b.nombre, orden: b.orden, temas: [] }));
      const porId = new Map(bloques.map((b) => [b.id, b]));
      const filas = db.query(`
        SELECT t.id, t.bloque_id AS bloque, t.numero, t.nombre, COUNT(p.id) AS preguntas
        FROM temas t LEFT JOIN preguntas p ON p.tema_id = t.id
        GROUP BY t.id ORDER BY COALESCE(t.numero, t.id), t.id`).all();
      const sinBloque = { id: null, nombre: "Sin bloque", orden: Number.MAX_SAFE_INTEGER, temas: [] };
      for (const f of filas) {
        const tema = { id: f.id, numero: f.numero, nombre: f.nombre, preguntas: f.preguntas };
        const b = porId.get(f.bloque);
        if (b) b.temas.push(tema); else sinBloque.temas.push(tema);
      }
      if (sinBloque.temas.length) bloques.push(sinBloque);
      return bloques;
    },

    crearBloque: db.transaction(({ nombre }) => {
      if (db.query("SELECT 1 FROM bloques WHERE nombre = ?").get(nombre)) throw new ErrorApi(409, `Ya existe el bloque «${nombre}».`);
      const orden = db.query("SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM bloques").get().n;
      const id = Number(db.query("INSERT INTO bloques (nombre, orden) VALUES (?, ?)").run(nombre, orden).lastInsertRowid);
      return { id, nombre, orden, temas: [] };
    }),

    actualizarBloque: db.transaction((id, { nombre }) => {
      if (!db.query("SELECT 1 FROM bloques WHERE id = ?").get(id)) return false;
      const otro = db.query("SELECT id FROM bloques WHERE nombre = ? AND id <> ?").get(nombre, id);
      if (otro) throw new ErrorApi(409, `Ya existe el bloque «${nombre}».`);
      db.query("UPDATE bloques SET nombre = ? WHERE id = ?").run(nombre, id);
      return { id, nombre };
    }),

    borrarBloque(id) {
      const n = db.query(`SELECT COUNT(*) AS n FROM temas t JOIN bloques b ON b.id = t.bloque_id WHERE b.id = ?`).get(id).n;
      if (n) throw new ErrorApi(409, `No se puede borrar el bloque: todavía tiene ${n} tema(s). Muévelos o bórralos primero.`);
      return db.query("DELETE FROM bloques WHERE id = ?").run(id).changes > 0;
    },

    /** Reordena los bloques según la lista de ids (debe incluirlos todos). */
    reordenarBloques: db.transaction((ids) => {
      const actuales = db.query("SELECT id FROM bloques").all().map((b) => b.id);
      if (ids.length !== actuales.length || new Set(ids).size !== ids.length || !ids.every((id) => actuales.includes(id)))
        throw new ErrorApi(400, "La lista de bloques no coincide con los bloques existentes.");
      const upd = db.query("UPDATE bloques SET orden = ? WHERE id = ?");
      ids.forEach((id, i) => upd.run(i, id));
      return true;
    }),

    crearTema: db.transaction(({ bloque, numero, nombre }) => {
      if (!db.query("SELECT 1 FROM bloques WHERE id = ?").get(bloque)) throw new ErrorApi(404, "El bloque no existe.");
      if (q.temaPorBloqueNumero.get(bloque, numero)) throw new ErrorApi(409, `Ya hay un tema ${numero} en ese bloque.`);
      const id = Number(q.insertarTema.run(null, bloque, numero, nombre || null).lastInsertRowid);
      return temaConPreguntas(id);
    }),

    actualizarTema: db.transaction((id, { bloque, numero, nombre }) => {
      if (!q.temaPorId.get(id)) return false;
      if (!db.query("SELECT 1 FROM bloques WHERE id = ?").get(bloque)) throw new ErrorApi(404, "El bloque no existe.");
      const otro = db.query("SELECT id FROM temas WHERE bloque_id = ? AND numero = ? AND id <> ?").get(bloque, numero, id);
      if (otro) throw new ErrorApi(409, `Ya hay un tema ${numero} en ese bloque (nº ${otro.id}).`);
      db.query("UPDATE temas SET bloque_id = ?, numero = ?, nombre = ? WHERE id = ?").run(bloque, numero, nombre || null, id);
      return temaConPreguntas(id);
    }),

    borrarTema(id) {
      const n = db.query("SELECT COUNT(*) AS n FROM preguntas WHERE tema_id = ?").get(id).n;
      if (n) throw new ErrorApi(409, `No se puede borrar el tema: todavía tiene ${n} pregunta(s).`);
      return db.query("DELETE FROM temas WHERE id = ?").run(id).changes > 0;
    },

    /** Preguntas (con opciones) de los temas dados, más el progreso de esas preguntas. */
    paraTest(temas) {
      if (!temas.length) return { preguntas: [], progreso: {} };
      const preguntas = ensamblar(
        db.query(`SELECT ${CAMPOS_PREGUNTA} ${JOINS_PREGUNTA}
                  WHERE p.tema_id IN (${marcas(temas.length)}) ORDER BY p.id`).all(...temas),
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
        `SELECT ${CAMPOS_PREGUNTA} ${JOINS_PREGUNTA} WHERE p.id IN (${marcas(pagina.length)})`).all(...pagina);
      const orden = new Map(pagina.map((id, i) => [id, i]));
      filas.sort((x, y) => orden.get(x.id) - orden.get(y.id));
      return { total: ids.length, items: ensamblar(filas, opcionesDe(pagina)) };
    },

    obtener(id) {
      const fila = db.query(`SELECT ${CAMPOS_PREGUNTA} ${JOINS_PREGUNTA} WHERE p.id = ?`).get(id);
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
      const filas = db.query(`SELECT ${CAMPOS_PREGUNTA} ${JOINS_PREGUNTA} ORDER BY p.tema_id, p.id`).all();
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
