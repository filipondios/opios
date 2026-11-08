import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH, CUPO_NUEVAS, FRENO_ATRASO } from "./config.js";
import { ErrorApi } from "./errores.js";
import { hoyIso, sumarDias } from "./fechas.js";
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
    clave_norm  TEXT    NOT NULL,                   -- enunciado normalizado: evita duplicados
    explicacion TEXT    NOT NULL DEFAULT '',
    creada      TEXT    NOT NULL DEFAULT (datetime('now')),
    modificada  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_preguntas_tema ON preguntas(tema_id);
  CREATE UNIQUE INDEX ux_preguntas_clave_norm ON preguntas(clave_norm);

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

  /* v3: resultados de simulacros (modo examen). No altera el progreso del repaso. */
  /* v3 */ `
  CREATE TABLE simulacros (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    temas        TEXT    NOT NULL,                     -- JSON con los ids de tema elegidos
    total        INTEGER NOT NULL CHECK (total > 0),
    aciertos     INTEGER NOT NULL CHECK (aciertos >= 0),
    fallos       INTEGER NOT NULL CHECK (fallos >= 0),
    en_blanco    INTEGER NOT NULL CHECK (en_blanco >= 0),
    penalizacion REAL    NOT NULL DEFAULT 0 CHECK (penalizacion >= 0 AND penalizacion <= 1),
    puntos       REAL    NOT NULL,
    segundos     INTEGER NOT NULL CHECK (segundos >= 0),
    detalle      TEXT    NOT NULL DEFAULT '[]',        -- JSON [{ id, elegida, correcta }]
    CHECK (aciertos + fallos + en_blanco = total)
  );
  CREATE INDEX idx_simulacros_fecha ON simulacros(fecha DESC, id DESC);
  `,

  /* v4: número estable de bloque (I, II, III...). El nombre puede cambiar; el número no. */
  /* v4 */ `
  ALTER TABLE bloques ADD COLUMN numero INTEGER CHECK (numero IS NULL OR numero > 0);
  UPDATE bloques SET numero = id;
  CREATE UNIQUE INDEX ux_bloques_numero ON bloques(numero);
  `,

  /* v5: bloques gestionados por `preguntas/bloque_X/info.json` (nombre y títulos de solo lectura). */
  /* v5 */ `
  ALTER TABLE bloques ADD COLUMN gestionado INTEGER NOT NULL DEFAULT 0 CHECK (gestionado IN (0, 1));
  `,

  /* v6: normaliza `temas`: bloque obligatorio e id AUTOINCREMENT (el número deja de ser el id). */
  /* v6 */ `
  INSERT INTO bloques (numero, nombre, orden)
    SELECT 1, 'Bloque 1', 0 WHERE NOT EXISTS (SELECT 1 FROM bloques);
  UPDATE temas SET bloque_id = (SELECT id FROM bloques ORDER BY orden, id LIMIT 1) WHERE bloque_id IS NULL;
  UPDATE temas SET numero = id WHERE numero IS NULL;

  /* Si hubiera números repetidos dentro de un bloque, los duplicados pasan al final. */
  WITH pendientes AS (
    SELECT id, bloque_id,
           ROW_NUMBER() OVER (PARTITION BY bloque_id, numero ORDER BY id) AS dup,
           ROW_NUMBER() OVER (PARTITION BY bloque_id ORDER BY id) AS orden
    FROM temas
  )
  UPDATE temas SET numero = (
    SELECT COALESCE(MAX(t2.numero), 0) FROM temas t2 WHERE t2.bloque_id = temas.bloque_id
  ) + (SELECT orden FROM pendientes p WHERE p.id = temas.id)
  WHERE id IN (SELECT id FROM pendientes WHERE dup > 1);

  CREATE TABLE temas_nuevo (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    bloque_id INTEGER NOT NULL REFERENCES bloques(id) ON UPDATE CASCADE,
    numero    INTEGER NOT NULL CHECK (numero >= 0),
    nombre    TEXT,
    UNIQUE (bloque_id, numero)
  );
  INSERT INTO temas_nuevo (id, bloque_id, numero, nombre)
    SELECT id, bloque_id, numero, nombre FROM temas;
  DROP TABLE temas;
  ALTER TABLE temas_nuevo RENAME TO temas;
  CREATE INDEX idx_temas_bloque ON temas(bloque_id);
  `,

  /* v7: clave de idempotencia para no duplicar un simulacro si el cliente reintenta el POST. */
  /* v7 */ `
  ALTER TABLE simulacros ADD COLUMN clave_idempotencia TEXT;
  CREATE UNIQUE INDEX ux_simulacros_clave
    ON simulacros(clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;
  `,

  /* v8: una fila por respuesta (test o simulacro) para estadísticas y cupos diarios. */
  /* v8 */ `
  CREATE TABLE respuestas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pregunta_id INTEGER NOT NULL REFERENCES preguntas(id) ON DELETE CASCADE,
    fecha       TEXT    NOT NULL CHECK (fecha GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    acierto     INTEGER NOT NULL CHECK (acierto IN (0, 1)),
    origen      TEXT    NOT NULL CHECK (origen IN ('test', 'simulacro')),
    ms          INTEGER CHECK (ms IS NULL OR (ms BETWEEN 0 AND 3600000))
  );
  CREATE INDEX idx_respuestas_fecha ON respuestas(fecha);
  CREATE INDEX idx_respuestas_pregunta ON respuestas(pregunta_id);
  `,

  /* v9: ajustes simples de la instancia (por ahora, la fecha de examen). */
  /* v9 */ `
  CREATE TABLE ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );
  `,

  /* v10: búsqueda con FTS5 (si el build de SQLite la incluye). Índice sobre el enunciado con
     `remove_diacritics`, de modo que «normalizacion» encuentra «normalización». */
  (db) => {
    if (!tieneFts5(db)) return "SELECT 1";
    return `
    CREATE VIRTUAL TABLE preguntas_fts USING fts5(
      enunciado,
      content='preguntas', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2');

    CREATE TRIGGER preguntas_ai AFTER INSERT ON preguntas BEGIN
      INSERT INTO preguntas_fts(rowid, enunciado) VALUES (new.id, new.enunciado);
    END;
    CREATE TRIGGER preguntas_ad AFTER DELETE ON preguntas BEGIN
      INSERT INTO preguntas_fts(preguntas_fts, rowid, enunciado) VALUES ('delete', old.id, old.enunciado);
    END;
    CREATE TRIGGER preguntas_au AFTER UPDATE ON preguntas BEGIN
      INSERT INTO preguntas_fts(preguntas_fts, rowid, enunciado) VALUES ('delete', old.id, old.enunciado);
      INSERT INTO preguntas_fts(rowid, enunciado) VALUES (new.id, new.enunciado);
    END;

    INSERT INTO preguntas_fts(preguntas_fts) VALUES ('rebuild');
    `;
  },

  /* v11: `id_externo` para actualizar preguntas desde el banco sin cambiar su id interno. */
  /* v11 */ `
  ALTER TABLE preguntas ADD COLUMN id_externo TEXT;
  CREATE UNIQUE INDEX ux_preguntas_id_externo
    ON preguntas(id_externo) WHERE id_externo IS NOT NULL;
  `,
];

/** Comprueba si el SQLite de este build incluye FTS5. */
function tieneFts5(db) {
  try {
    db.run("CREATE VIRTUAL TABLE temp.fts_probe USING fts5(x, tokenize='unicode61 remove_diacritics 2')");
    db.run("DROP TABLE temp.fts_probe");
    return true;
  } catch {
    try { db.run("DROP TABLE IF EXISTS temp.fts_probe"); } catch { /* nada */ }
    return false;
  }
}

/** Convierte un texto libre en una consulta FTS5 segura (comillas + comodín de prefijo por palabra). */
function consultaFts(texto) {
  const palabras = String(texto).split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
  if (!palabras.length) return null;
  return palabras.map((p) => `"${p.replace(/"/g, '""')}"*`).join(" ");
}

/** Convierte una fila de `simulacros` en el objeto que consume la app. */
function normalizarSimulacro(fila) {
  if (!fila) return null;
  const s = { ...fila, temas: JSON.parse(fila.temas) };
  if (fila.detalle !== undefined) s.detalle = JSON.parse(fila.detalle);
  return s;
}

function migrar(db) {
  const actual = db.query("PRAGMA user_version").get().user_version;
  if (actual >= MIGRACIONES.length) return;
  /* Las reconstrucciones de tablas (v6) necesitan desactivar las FK fuera de la transacción. */
  db.run("PRAGMA foreign_keys = OFF");
  try {
    for (let v = actual; v < MIGRACIONES.length; v++) {
      db.transaction(() => {
        const migracion = MIGRACIONES[v];
        db.run(typeof migracion === "function" ? migracion(db) : migracion);
        const roto = db.query("PRAGMA foreign_key_check").all();
        if (roto.length) throw new Error(`La migración v${v + 1} deja referencias rotas.`);
        db.run(`PRAGMA user_version = ${v + 1}`);
      })();
    }
  } finally {
    db.run("PRAGMA foreign_keys = ON");
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
  const ftsDisponible = tieneFts5(db);

  const q = {
    temaPorId: db.query("SELECT id FROM temas WHERE id = ?"),
    temaPorBloqueNumero: db.query("SELECT id FROM temas WHERE bloque_id = ? AND numero = ?"),
    insertarTema: db.query("INSERT INTO temas (bloque_id, numero, nombre) VALUES (?, ?, ?)"),
    porClaveNorm: db.query("SELECT id, tema_id AS tema FROM preguntas WHERE clave_norm = ?"),
    porIdExterno: db.query("SELECT id, tema_id AS tema FROM preguntas WHERE id_externo = ?"),
    insertarPregunta: db.query(
      "INSERT INTO preguntas (tema_id, enunciado, clave_norm, explicacion, id_externo) VALUES (?, ?, ?, ?, ?)"),
    actualizarPregunta: db.query(
      "UPDATE preguntas SET tema_id = ?, enunciado = ?, clave_norm = ?, explicacion = ?, id_externo = ?, modificada = datetime('now') WHERE id = ?"),
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

  /* Une filas de preguntas con sus opciones y los datos de su tema/bloque. */
  function ensamblar(filasPreguntas, filasOpciones) {
    const porId = new Map();
    for (const p of filasPreguntas) {
      porId.set(p.id, {
        id: p.id, tema: p.tema,
        tema_numero: p.tema_numero ?? p.tema,
        tema_nombre: p.tema_nombre ?? null,
        bloque: p.bloque ?? null,
        bloque_numero: p.bloque_numero ?? null,
        bloque_nombre: p.bloque_nombre ?? "Sin bloque",
        pregunta: p.enunciado, respuestas: [], correcta: 0, explicacion: p.explicacion,
        id_externo: p.id_externo ?? null,
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

  /* Búsqueda de respaldo sin FTS5: filtra en JS porque lower() de SQLite solo entiende ASCII. */
  function buscarEnJs(texto, tema) {
    const cond = tema !== null ? "WHERE tema_id = ?" : "";
    const args = tema !== null ? [tema] : [];
    const buscado = texto.toLowerCase();
    return db.query(`SELECT id, enunciado FROM preguntas ${cond} ORDER BY id DESC`).all(...args)
      .filter((f) => f.enunciado.toLowerCase().includes(buscado)).map((f) => f.id);
  }

  /* Primer bloque por orden, o uno nuevo si aún no hay ninguno. */
  function bloquePorDefecto() {
    const b = db.query("SELECT id FROM bloques ORDER BY orden, id LIMIT 1").get();
    if (b) return b.id;
    return Number(db.query("INSERT INTO bloques (numero, nombre, orden) VALUES (1, 'Bloque 1', 0)").run().lastInsertRowid);
  }

  /* Bloque por su nombre; si no existe, se crea al final con el siguiente número. */
  function bloquePorNombre(nombre) {
    const b = db.query("SELECT id FROM bloques WHERE nombre = ?").get(nombre);
    if (b) return b.id;
    const numero = db.query("SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM bloques").get().n;
    const orden = db.query("SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM bloques").get().n;
    return Number(db.query("INSERT INTO bloques (numero, nombre, orden) VALUES (?, ?, ?)").run(numero, nombre, orden).lastInsertRowid);
  }

  /* Bloque por número (identidad estable); si no existe, se crea con ese nombre. */
  function asegurarBloque(numero, nombre) {
    const b = db.query("SELECT id FROM bloques WHERE numero = ?").get(numero);
    if (b) return b.id;
    const orden = db.query("SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM bloques").get().n;
    return Number(db.query("INSERT INTO bloques (numero, nombre, orden) VALUES (?, ?, ?)").run(numero, nombre || `Bloque ${numero}`, orden).lastInsertRowid);
  }

  /* Resuelve un tema del formato antiguo (sin bloque): su `tema` es el número dentro del bloque por defecto. */
  function temaLegacy(numero) {
    const bloque = bloquePorDefecto();
    const existente = q.temaPorBloqueNumero.get(bloque, numero);
    if (existente) return existente.id;
    return Number(q.insertarTema.run(bloque, numero, null).lastInsertRowid);
  }

  /* Garantiza que existe el tema `numero` dentro del bloque (por número estable o, si falta, por nombre). */
  function asegurarTemaEnBloque(bloqueNumero, bloqueNombre, numero) {
    const bloque = bloqueNumero != null ? asegurarBloque(bloqueNumero, bloqueNombre) : bloquePorNombre(bloqueNombre);
    const existente = q.temaPorBloqueNumero.get(bloque, numero);
    if (existente) return existente.id;
    return Number(q.insertarTema.run(bloque, numero, null).lastInsertRowid);
  }

  /* Inserta o actualiza una pregunta con sus opciones. Debe llamarse dentro de una transacción. */
  function guardar(id, v) {
    const claveNorm = claveDe(v.pregunta);
    const otra = q.porClaveNorm.get(claveNorm);
    if (otra && otra.id !== id) {
      throw new ErrorApi(409, `Ya hay una pregunta con este mismo enunciado (nº ${otra.id}, tema ${otra.tema}).`, { existente: { id: otra.id, tema: otra.tema } });
    }
    const idExterno = v.id_externo ?? null;
    if (idExterno != null) {
      const porExterno = q.porIdExterno.get(idExterno);
      if (porExterno && porExterno.id !== id) {
        throw new ErrorApi(409, `Ya hay una pregunta con el identificador externo «${idExterno}» (nº ${porExterno.id}, tema ${porExterno.tema}).`, { existente: { id: porExterno.id, tema: porExterno.tema } });
      }
    }
    const tema = v.bloque
      ? asegurarTemaEnBloque(v.bloque_numero ?? null, v.bloque, v.tema_numero ?? v.tema)
      : q.temaPorId.get(v.tema)?.id;
    if (!tema) throw new ErrorApi(404, "El tema no existe. Créalo desde Temario.");
    if (id == null) {
      id = Number(q.insertarPregunta.run(tema, v.pregunta, claveNorm, v.explicacion, idExterno).lastInsertRowid);
    } else {
      q.actualizarPregunta.run(tema, v.pregunta, claveNorm, v.explicacion, idExterno, id);
      q.borrarOpciones.run(id);
    }
    v.respuestas.forEach((texto, k) => q.insertarOpcion.run(id, k, texto, k === v.correcta ? 1 : 0));
    return id;
  }

  /* Consulta base que añade el tema y el bloque a cada pregunta. */
  const CAMPOS_PREGUNTA = `
    p.id, p.tema_id AS tema, t.numero AS tema_numero, t.nombre AS tema_nombre,
    t.bloque_id AS bloque, b.numero AS bloque_numero, b.nombre AS bloque_nombre,
    p.enunciado, p.explicacion, p.id_externo`;
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
               t.bloque_id AS bloque, b.nombre AS bloque_nombre, b.numero AS bloque_numero,
               COALESCE(b.orden, 2147483647) AS bloque_orden, COUNT(*) AS total,
               COALESCE(SUM(pr.pregunta_id IS NULL), 0) AS nuevas,
               COALESCE(SUM(pr.vence <= ?), 0)          AS repaso,
               COALESCE(SUM(pr.caja >= ?), 0)           AS dominadas,
               COALESCE(SUM(pr.caja < ?), 0)            AS aprendiendo,
               COALESCE(SUM(pr.aciertos), 0)            AS aciertos,
               COALESCE(SUM(pr.fallos), 0)              AS fallos
        FROM preguntas p
        JOIN temas t ON t.id = p.tema_id
        LEFT JOIN bloques b ON b.id = t.bloque_id
        LEFT JOIN progreso pr ON pr.pregunta_id = p.id
        GROUP BY p.tema_id
        ORDER BY COALESCE(b.orden, 2147483647), COALESCE(t.numero, t.id), p.tema_id`).all(hoy, cajaDominada, cajaDominada);
    },

    /** Bloques ordenados con sus temas (numerados dentro del bloque) y el número de preguntas de cada tema. */
    temario() {
      const bloques = db.query("SELECT id, numero, nombre, orden, gestionado FROM bloques ORDER BY orden, id").all()
        .map((b) => ({ id: b.id, numero: b.numero, nombre: b.nombre, orden: b.orden, gestionado: !!b.gestionado, temas: [] }));
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

    /** Crea el bloque si no existe; no cambia el nombre de uno existente. */
    asegurarBloque: db.transaction(({ numero, nombre }) => {
      const id = asegurarBloque(numero, nombre);
      return db.query("SELECT id, numero, nombre, orden, gestionado FROM bloques WHERE id = ?").get(id);
    }),

    /**
     * Sincroniza un bloque con su `info.json`: nombre, títulos de temas y marca de gestionado.
     * No borra temas que ya no aparezcan en el archivo.
     */
    sincronizarInfoBloque: db.transaction((numero, info) => {
      const id = asegurarBloque(numero, info.nombre);
      db.query("UPDATE bloques SET nombre = ?, gestionado = 1 WHERE id = ?").run(info.nombre, id);
      for (const t of info.temas) {
        const existente = q.temaPorBloqueNumero.get(id, t.numero);
        if (existente) db.query("UPDATE temas SET nombre = ? WHERE id = ?").run(t.titulo, existente.id);
        else q.insertarTema.run(id, t.numero, t.titulo);
      }
      return { id, numero, nombre: info.nombre, temas: info.temas.length };
    }),

    /** Quita la marca de gestionado a los bloques que ya no tienen `info.json`. */
    desmarcarGestionadosExcepto: db.transaction((numeros) => {
      const lista = [...new Set(numeros)];
      if (!lista.length) return db.query("UPDATE bloques SET gestionado = 0 WHERE gestionado = 1").run().changes;
      return db.query(`UPDATE bloques SET gestionado = 0 WHERE gestionado = 1 AND numero NOT IN (${marcas(lista.length)})`).run(...lista).changes;
    }),

    crearBloque: db.transaction(({ nombre }) => {
      if (db.query("SELECT 1 FROM bloques WHERE nombre = ?").get(nombre)) throw new ErrorApi(409, `Ya existe el bloque «${nombre}».`);
      const numero = db.query("SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM bloques").get().n;
      const orden = db.query("SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM bloques").get().n;
      const id = Number(db.query("INSERT INTO bloques (numero, nombre, orden) VALUES (?, ?, ?)").run(numero, nombre, orden).lastInsertRowid);
      return { id, numero, nombre, orden, gestionado: false, temas: [] };
    }),

    actualizarBloque: db.transaction((id, { nombre }) => {
      const bloque = db.query("SELECT id, numero, gestionado FROM bloques WHERE id = ?").get(id);
      if (!bloque) return false;
      if (bloque.gestionado) throw new ErrorApi(409, "Este bloque se define en preguntas/bloque_X/info.json y es de solo lectura.");
      const otro = db.query("SELECT id FROM bloques WHERE nombre = ? AND id <> ?").get(nombre, id);
      if (otro) throw new ErrorApi(409, `Ya existe el bloque «${nombre}».`);
      db.query("UPDATE bloques SET nombre = ? WHERE id = ?").run(nombre, id);
      return { id, numero: bloque.numero, nombre, gestionado: false };
    }),

    borrarBloque(id) {
      const bloque = db.query("SELECT gestionado FROM bloques WHERE id = ?").get(id);
      if (bloque?.gestionado) throw new ErrorApi(409, "Este bloque se define en preguntas/bloque_X/info.json y es de solo lectura.");
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
      const b = db.query("SELECT gestionado FROM bloques WHERE id = ?").get(bloque);
      if (!b) throw new ErrorApi(404, "El bloque no existe.");
      if (b.gestionado) throw new ErrorApi(409, "Este bloque se define en preguntas/bloque_X/info.json y es de solo lectura.");
      if (q.temaPorBloqueNumero.get(bloque, numero)) throw new ErrorApi(409, `Ya hay un tema ${numero} en ese bloque.`);
      const id = Number(q.insertarTema.run(bloque, numero, nombre || null).lastInsertRowid);
      return temaConPreguntas(id);
    }),

    actualizarTema: db.transaction((id, { bloque, numero, nombre }) => {
      const actual = db.query(`
        SELECT t.id, b.gestionado FROM temas t JOIN bloques b ON b.id = t.bloque_id WHERE t.id = ?`).get(id);
      if (!actual) return false;
      if (actual.gestionado) throw new ErrorApi(409, "Este tema se define en preguntas/bloque_X/info.json y es de solo lectura.");
      const b = db.query("SELECT gestionado FROM bloques WHERE id = ?").get(bloque);
      if (!b) throw new ErrorApi(404, "El bloque no existe.");
      if (b.gestionado) throw new ErrorApi(409, "No se puede mover un tema a un bloque gestionado por info.json.");
      const otro = db.query("SELECT id FROM temas WHERE bloque_id = ? AND numero = ? AND id <> ?").get(bloque, numero, id);
      if (otro) throw new ErrorApi(409, `Ya hay un tema ${numero} en ese bloque (nº ${otro.id}).`);
      db.query("UPDATE temas SET bloque_id = ?, numero = ?, nombre = ? WHERE id = ?").run(bloque, numero, nombre || null, id);
      return temaConPreguntas(id);
    }),

    borrarTema(id) {
      const t = db.query(`SELECT b.gestionado FROM temas t JOIN bloques b ON b.id = t.bloque_id WHERE t.id = ?`).get(id);
      if (t?.gestionado) throw new ErrorApi(409, "Este tema se define en preguntas/bloque_X/info.json y es de solo lectura.");
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
    reiniciarProgreso: () => { q.borrarProgreso.run(); db.run("DELETE FROM respuestas"); },

    /** Registra un lote de respuestas del test. Devuelve cuántas se han insertado. */
    registrarRespuestas: db.transaction((entradas, hoy, origen = "test") => {
      let n = 0;
      for (const e of entradas) n += q.insertarRespuesta.run(e.id, hoy, e.acierto, origen, e.ms ?? null).changes;
      return n;
    }),

    /** Totales globales de progreso, para la cabecera de la página de estadísticas. */
    estadisticasGlobales(hoy, cajaDominada) {
      return db.query(`
        SELECT COUNT(*) AS total,
               COALESCE(SUM(pr.pregunta_id IS NULL), 0)                  AS nuevas,
               COALESCE(SUM(pr.caja >= ?), 0)                            AS dominadas,
               COALESCE(SUM(pr.caja < ? AND pr.pregunta_id IS NOT NULL), 0) AS aprendiendo,
               COALESCE(SUM(pr.vence <= ?), 0)                           AS repaso,
               COALESCE(SUM(pr.aciertos), 0)                             AS aciertos,
               COALESCE(SUM(pr.fallos), 0)                               AS fallos
        FROM preguntas p LEFT JOIN progreso pr ON pr.pregunta_id = p.id`).get(cajaDominada, cajaDominada, hoy);
    },

    /** Repasos agrupados por fecha de vencimiento, desde el pasado hasta `hoy + dias - 1`. */
    previsionRepasos(hoy, dias = 7) {
      const hasta = sumarDias(hoy, Math.max(1, dias) - 1);
      return db.query(`
        SELECT vence, COUNT(*) AS n FROM progreso
        WHERE vence <= ? GROUP BY vence ORDER BY vence`).all(hasta);
    },

    /** Preguntas con más fallos. Los fallos de test y de simulacro viven todos en `progreso`. */
    preguntasMasFalladas(limite = 20) {
      return db.query(`
        SELECT p.id, p.enunciado, t.numero AS tema_numero, t.nombre AS tema_nombre,
               b.nombre AS bloque_nombre,
               COALESCE(pr.fallos, 0)   AS fallos,
               COALESCE(pr.aciertos, 0) AS aciertos,
               pr.caja
        FROM preguntas p
        JOIN temas t ON t.id = p.tema_id
        LEFT JOIN bloques b ON b.id = t.bloque_id
        LEFT JOIN progreso pr ON pr.pregunta_id = p.id
        WHERE COALESCE(pr.fallos, 0) > 0
        ORDER BY fallos DESC, aciertos ASC, p.id
        LIMIT ?`).all(limite);
    },

    /** Respuestas por día desde `desde` (AAAA-MM-DD), con el desglose acierto/fallo. */
    actividadReciente(desde) {
      return db.query(`
        SELECT fecha AS dia, COUNT(*) AS n,
               COALESCE(SUM(acierto = 1), 0) AS aciertos,
               COALESCE(SUM(acierto = 0), 0) AS fallos
        FROM respuestas
        WHERE fecha >= ?
        GROUP BY fecha ORDER BY fecha`).all(desde);
    },

    /**
     * Carga del día para los límites de Fase 3:
     * `nuevasHoy` cuenta las preguntas cuya primera respuesta registrada es de hoy y vino de un test
     * (los simulacros no consumen cupo). `bloqueadoPorAtraso` frena las nuevas si hay demasiados repasos atrasados.
     */
    cargaDiaria(hoy) {
      const nuevasHoy = db.query(`
        SELECT COUNT(*) AS n FROM respuestas r
        WHERE r.origen = 'test' AND r.fecha = ?
          AND NOT EXISTS (SELECT 1 FROM respuestas r2 WHERE r2.pregunta_id = r.pregunta_id AND r2.id < r.id)`).get(hoy).n;
      const repasosPendientes = db.query("SELECT COUNT(*) AS n FROM progreso WHERE vence <= ?").get(hoy).n;
      const repasosAtrasados = db.query("SELECT COUNT(*) AS n FROM progreso WHERE vence < ?").get(hoy).n;
      return {
        nuevasHoy,
        cupoNuevas: CUPO_NUEVAS,
        repasosPendientes,
        repasosAtrasados,
        bloqueadoPorAtraso: repasosAtrasados > FRENO_ATRASO * CUPO_NUEVAS,
      };
    },

    /** Días consecutivos con al menos una respuesta, terminando hoy (o ayer si hoy aún no hay actividad). */
    rachaDias(hoy) {
      const fechas = new Set(db.query("SELECT DISTINCT fecha FROM respuestas").all().map((r) => r.fecha));
      let dia = fechas.has(hoy) ? hoy : sumarDias(hoy, -1);
      let racha = 0;
      while (fechas.has(dia)) { racha++; dia = sumarDias(dia, -1); }
      return racha;
    },

    /** Precisión agrupada por semanas (de lunes a domingo) de las últimas `semanas`. */
    precisionSemanal(hoy, semanas = 8) {
      const desde = sumarDias(hoy, -(Math.max(1, semanas) * 7 - 1));
      const filas = db.query(
        `SELECT fecha, COUNT(*) AS n, COALESCE(SUM(acierto), 0) AS aciertos
         FROM respuestas WHERE fecha >= ? GROUP BY fecha`).all(desde);
      const inicioSemana = (fecha) => sumarDias(fecha, -((new Date(fecha + "T12:00:00").getDay() + 6) % 7));
      const mapa = new Map();
      for (const f of filas) {
        const s = inicioSemana(f.fecha);
        const g = mapa.get(s) ?? { desde: s, hasta: sumarDias(s, 6), aciertos: 0, fallos: 0 };
        g.aciertos += f.aciertos; g.fallos += f.n - f.aciertos;
        mapa.set(s, g);
      }
      return [...mapa.values()].sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0));
    },

    /** Tiempo medio de respuesta en ms (solo tests, que sí miden `ms`). */
    tiempoMedio() {
      const r = db.query("SELECT AVG(ms) AS ms, COUNT(*) AS n FROM respuestas WHERE ms IS NOT NULL").get();
      return { ms: r.n ? Math.round(r.ms) : null, n: r.n };
    },

    /** Ajustes de la instancia como objeto clave/valor (por ahora, `fecha_examen`). */
    ajustes() {
      const filas = db.query("SELECT clave, valor FROM ajustes").all();
      return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
    },

    /** Guarda (o borra, con valor vacío) un ajuste. */
    guardarAjuste: db.transaction((clave, valor) => {
      if (valor == null || valor === "") db.query("DELETE FROM ajustes WHERE clave = ?").run(clave);
      else db.query(`INSERT INTO ajustes (clave, valor) VALUES (?, ?)
                     ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor`).run(clave, valor);
    }),

    contarSimulacros: () => db.query("SELECT COUNT(*) AS n FROM simulacros").get().n,

    /**
     * Guarda un simulacro. Los aciertos se recalculan aquí desde las opciones correctas.
     * Los fallos entran en `progreso` (caja -2, vence hoy); los aciertos solo suman contador.
     * Con `clave_idempotencia`, repetir el POST devuelve el simulacro ya guardado.
     */
    crearSimulacro: db.transaction(({ temas, segundos, penalizacion, respuestas, clave_idempotencia = null }, hoy = hoyIso()) => {
      if (clave_idempotencia) {
        const existente = db.query("SELECT * FROM simulacros WHERE clave_idempotencia = ?").get(clave_idempotencia);
        if (existente) return normalizarSimulacro(existente);
      }
      const ids = respuestas.map((r) => r.id);
      const filas = db.query(
        `SELECT pregunta_id, posicion FROM opciones
         WHERE es_correcta = 1 AND pregunta_id IN (${marcas(ids.length)})`).all(...ids);
      const correctas = new Map(filas.map((f) => [f.pregunta_id, f.posicion]));
      const detalle = [];
      let aciertos = 0, fallos = 0, enBlanco = 0;
      for (const r of respuestas) {
        const correcta = correctas.get(r.id);
        if (correcta == null) throw new ErrorApi(400, `La pregunta ${r.id} no existe.`);
        const blanco = r.elegida == null || r.elegida < 0;
        if (blanco) enBlanco++;
        else if (r.elegida === correcta) {
          aciertos++;
          q.aciertoSimulacro.run(r.id);
          q.insertarRespuesta.run(r.id, hoy, 1, "simulacro", null);
        } else {
          fallos++;
          q.falloSimulacro.run(r.id, hoy);
          q.insertarRespuesta.run(r.id, hoy, 0, "simulacro", null);
        }
        detalle.push({ id: r.id, elegida: blanco ? null : r.elegida, correcta });
      }
      const total = respuestas.length;
      const puntos = Math.round((aciertos - fallos * penalizacion) * 100) / 100;
      const info = db.query(`
        INSERT INTO simulacros (temas, total, aciertos, fallos, en_blanco, penalizacion, puntos, segundos, detalle, clave_idempotencia)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          JSON.stringify(temas), total, aciertos, fallos, enBlanco, penalizacion, puntos, segundos,
          JSON.stringify(detalle), clave_idempotencia);
      return normalizarSimulacro(db.query("SELECT * FROM simulacros WHERE id = ?").get(Number(info.lastInsertRowid)));
    }),

    listarSimulacros(limite = 20) {
      return db.query(`
        SELECT id, fecha, temas, total, aciertos, fallos, en_blanco, penalizacion, puntos, segundos
        FROM simulacros ORDER BY fecha DESC, id DESC LIMIT ?`).all(limite).map(normalizarSimulacro);
    },

    obtenerSimulacro(id) {
      return normalizarSimulacro(db.query("SELECT * FROM simulacros WHERE id = ?").get(id));
    },

    /** Listado paginado del creador, con filtro por tema y búsqueda en el enunciado.
        Con FTS5 la búsqueda va en SQL (insensible a tildes y mayúsculas); si no, se filtra en JS. */
    listar({ tema = null, texto = "", limite = 50, desde = 0 } = {}) {
      let ids;
      const consulta = texto && ftsDisponible ? consultaFts(texto) : null;
      if (consulta) {
        const filtro = tema !== null ? "AND p.tema_id = ?" : "";
        const args = tema !== null ? [consulta, tema] : [consulta];
        try {
          ids = db.query(
            `SELECT p.id FROM preguntas_fts f JOIN preguntas p ON p.id = f.rowid
             WHERE f.preguntas_fts MATCH ? ${filtro} ORDER BY p.id DESC`).all(...args).map((f) => f.id);
        } catch {
          ids = buscarEnJs(texto, tema); // consulta FTS no válida pese al saneado
        }
      } else if (texto) {
        ids = buscarEnJs(texto, tema);
      } else {
        const cond = tema !== null ? "WHERE tema_id = ?" : "";
        const args = tema !== null ? [tema] : [];
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
      const actual = db.query("SELECT id_externo FROM preguntas WHERE id = ?").get(id);
      if (!actual) return false;
      /* La API no envía id_externo: conserva el que ya tuviera la pregunta. */
      guardar(id, v.id_externo === undefined ? { ...v, id_externo: actual.id_externo } : v);
      return true;
    }),

    borrar: (id) => q.borrarPregunta.run(id).changes > 0,

    /** Todas las preguntas en el formato JSON antiguo (copia de seguridad). */
    todas() {
      const filas = db.query(`SELECT ${CAMPOS_PREGUNTA} ${JOINS_PREGUNTA} ORDER BY p.tema_id, p.id`).all();
      const ops = db.query("SELECT pregunta_id, posicion, texto, es_correcta FROM opciones ORDER BY pregunta_id, posicion").all();
      return ensamblar(filas, ops);
    },

    /** Importa preguntas ya validadas; las que ya existen (mismo enunciado normalizado) se omiten.
        Con `actualizar`, las que traen `id_externo` y ya existen se actualizan conservando su id. */
    importar: db.transaction((lista, { actualizar = false } = {}) => {
      let nuevas = 0, duplicadas = 0, actualizadas = 0;
      for (const original of lista) {
        /* Formato antiguo sin bloque: `tema` es el número dentro del bloque por defecto. */
        const v = original.bloque ? original : { ...original, tema: temaLegacy(original.tema) };
        if (actualizar && v.id_externo != null) {
          const existente = q.porIdExterno.get(v.id_externo);
          if (existente) { guardar(existente.id, v); actualizadas++; continue; }
        }
        if (q.porClaveNorm.get(claveDe(v.pregunta))) { duplicadas++; continue; }
        guardar(null, v); nuevas++;
      }
      return { nuevas, duplicadas, actualizadas };
    }),
  };
  return repo;
}
