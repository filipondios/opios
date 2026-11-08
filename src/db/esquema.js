/* Esquema, migraciones y utilidades comunes de SQLite. */
import { claveDe } from "../validar.js";

export const MIGRACIONES = [
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

    /* v12: bases creadas antes del renombrado usan la columna `clave`, con un enunciado normalizado
     antiguo. Se pasa a `clave_norm` y se recalculan los valores con la normalización actual, para
     que la deduplicación del seed reconozca las preguntas ya importadas. */
    (db) => {
        const columnas = db
            .query("PRAGMA table_info(preguntas)")
            .all()
            .map((c) => c.name);
        if (!columnas.includes("clave")) return "SELECT 1";
        db.run("DROP INDEX IF EXISTS ux_preguntas_clave_norm");
        db.run("ALTER TABLE preguntas RENAME COLUMN clave TO clave_norm");
        const actualizar = db.query("UPDATE preguntas SET clave_norm = ? WHERE id = ?");
        for (const p of db.query("SELECT id, enunciado FROM preguntas").all())
            actualizar.run(claveDe(p.enunciado), p.id);
        db.run("CREATE UNIQUE INDEX IF NOT EXISTS ux_preguntas_clave_norm ON preguntas(clave_norm)");
        return "SELECT 1";
    },
];

/** Comprueba si el SQLite de este build incluye FTS5. */
export function tieneFts5(db) {
    try {
        db.run("CREATE VIRTUAL TABLE temp.fts_probe USING fts5(x, tokenize='unicode61 remove_diacritics 2')");
        db.run("DROP TABLE temp.fts_probe");
        return true;
    } catch {
        try {
            db.run("DROP TABLE IF EXISTS temp.fts_probe");
        } catch {
            /* nada */
        }
        return false;
    }
}

/** Aplica las migraciones pendientes y actualiza `user_version`. */
export function migrar(db) {
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
export { marcas };
