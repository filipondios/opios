import { ErrorApi } from "../errores.js";
import { claveDe } from "../validar.js";
import { marcas } from "./esquema.js";

/** Convierte un texto libre en una consulta FTS5 segura (comillas + comodín de prefijo por palabra). */
function consultaFts(texto) {
  const palabras = String(texto)
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
  if (!palabras.length) return null;
  return palabras.map((p) => `"${p.replace(/"/g, '""')}"*`).join(" ");
}

/** Preguntas: CRUD, búsqueda, importación y preparación de tests. */
export function crearPreguntas({ db, q, ftsDisponible, asegurarTemaEnBloque, temaLegacy }) {
  /* Une filas de preguntas con sus opciones y los datos de su tema/bloque. */
  function ensamblar(filasPreguntas, filasOpciones) {
    const porId = new Map();
    for (const p of filasPreguntas) {
      porId.set(p.id, {
        id: p.id,
        tema: p.tema,
        tema_numero: p.tema_numero ?? p.tema,
        tema_nombre: p.tema_nombre ?? null,
        bloque: p.bloque ?? null,
        bloque_numero: p.bloque_numero ?? null,
        bloque_nombre: p.bloque_nombre ?? "Sin bloque",
        pregunta: p.enunciado,
        respuestas: [],
        correcta: 0,
        explicacion: p.explicacion,
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
    return db
      .query(
        `SELECT pregunta_id, posicion, texto, es_correcta FROM opciones
       WHERE pregunta_id IN (${marcas(ids.length)}) ORDER BY pregunta_id, posicion`,
      )
      .all(...ids);
  }

  /* Búsqueda de respaldo sin FTS5: filtra en JS porque lower() de SQLite solo entiende ASCII. */
  function buscarEnJs(texto, tema) {
    const cond = tema !== null ? "WHERE tema_id = ?" : "";
    const args = tema !== null ? [tema] : [];
    const buscado = texto.toLowerCase();
    return db
      .query(`SELECT id, enunciado FROM preguntas ${cond} ORDER BY id DESC`)
      .all(...args)
      .filter((f) => f.enunciado.toLowerCase().includes(buscado))
      .map((f) => f.id);
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

  /* Inserta o actualiza una pregunta con sus opciones. Debe llamarse dentro de una transacción. */
  function guardar(id, v) {
    const claveNorm = claveDe(v.pregunta);
    const otra = q.porClaveNorm.get(claveNorm);
    if (otra && otra.id !== id) {
      throw new ErrorApi(409, `Ya hay una pregunta con este mismo enunciado (nº ${otra.id}, tema ${otra.tema}).`, {
        existente: { id: otra.id, tema: otra.tema },
      });
    }
    const idExterno = v.id_externo ?? null;
    if (idExterno != null) {
      const porExterno = q.porIdExterno.get(idExterno);
      if (porExterno && porExterno.id !== id) {
        throw new ErrorApi(
          409,
          `Ya hay una pregunta con el identificador externo «${idExterno}» (nº ${porExterno.id}, tema ${porExterno.tema}).`,
          { existente: { id: porExterno.id, tema: porExterno.tema } },
        );
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

  return {
    contarPreguntas: () => q.contar.get().n,

    /** Preguntas (con opciones) de los temas dados, más el progreso de esas preguntas. */
    paraTest(temas) {
      if (!temas.length) return { preguntas: [], progreso: {} };
      const preguntas = ensamblar(
        db
          .query(`SELECT ${CAMPOS_PREGUNTA} ${JOINS_PREGUNTA}
                  WHERE p.tema_id IN (${marcas(temas.length)}) ORDER BY p.id`)
          .all(...temas),
        db
          .query(`SELECT o.pregunta_id, o.posicion, o.texto, o.es_correcta FROM opciones o
                  JOIN preguntas p ON p.id = o.pregunta_id
                  WHERE p.tema_id IN (${marcas(temas.length)}) ORDER BY o.pregunta_id, o.posicion`)
          .all(...temas),
      );
      const progreso = {};
      const filas = db
        .query(
          `SELECT pr.pregunta_id AS id, pr.caja, pr.vence, pr.aciertos, pr.fallos FROM progreso pr
         JOIN preguntas p ON p.id = pr.pregunta_id WHERE p.tema_id IN (${marcas(temas.length)})`,
        )
        .all(...temas);
      for (const f of filas) progreso[f.id] = [f.caja, f.vence, f.aciertos, f.fallos];
      return { preguntas, progreso };
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
          ids = db
            .query(
              `SELECT p.id FROM preguntas_fts f JOIN preguntas p ON p.id = f.rowid
             WHERE f.preguntas_fts MATCH ? ${filtro} ORDER BY p.id DESC`,
            )
            .all(...args)
            .map((f) => f.id);
        } catch {
          ids = buscarEnJs(texto, tema); // consulta FTS no válida pese al saneado
        }
      } else if (texto) {
        ids = buscarEnJs(texto, tema);
      } else {
        const cond = tema !== null ? "WHERE tema_id = ?" : "";
        const args = tema !== null ? [tema] : [];
        ids = db
          .query(`SELECT id FROM preguntas ${cond} ORDER BY id DESC`)
          .all(...args)
          .map((f) => f.id);
      }
      const pagina = ids.slice(desde, desde + limite);
      if (!pagina.length) return { total: ids.length, items: [] };
      const filas = db
        .query(`SELECT ${CAMPOS_PREGUNTA} ${JOINS_PREGUNTA} WHERE p.id IN (${marcas(pagina.length)})`)
        .all(...pagina);
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
      const ops = db
        .query("SELECT pregunta_id, posicion, texto, es_correcta FROM opciones ORDER BY pregunta_id, posicion")
        .all();
      return ensamblar(filas, ops);
    },

    /** Importa preguntas ya validadas; las que ya existen (mismo enunciado normalizado) se omiten.
        Con `actualizar`, las que traen `id_externo` y ya existen se actualizan conservando su id. */
    importar: db.transaction((lista, { actualizar = false } = {}) => {
      let nuevas = 0,
        duplicadas = 0,
        actualizadas = 0;
      for (const original of lista) {
        /* Formato antiguo sin bloque: `tema` es el número dentro del bloque por defecto. */
        const v = original.bloque ? original : { ...original, tema: temaLegacy(original.tema) };
        if (actualizar && v.id_externo != null) {
          const existente = q.porIdExterno.get(v.id_externo);
          if (existente) {
            guardar(existente.id, v);
            actualizadas++;
            continue;
          }
        }
        if (q.porClaveNorm.get(claveDe(v.pregunta))) {
          duplicadas++;
          continue;
        }
        guardar(null, v);
        nuevas++;
      }
      return { nuevas, duplicadas, actualizadas };
    }),
  };
}
