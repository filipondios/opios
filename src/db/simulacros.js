import { ErrorApi } from "../errores.js";
import { hoyIso } from "../fechas.js";
import { marcas } from "./esquema.js";

/** Convierte una fila de `simulacros` en el objeto que consume la app. */
function normalizarSimulacro(fila) {
  if (!fila) return null;
  const s = { ...fila, temas: JSON.parse(fila.temas) };
  if (fila.detalle !== undefined) s.detalle = JSON.parse(fila.detalle);
  return s;
}

/** Resultados de los simulacros (modo examen). */
export function crearSimulacros({ db, q }) {
  return {
    contarSimulacros: () => db.query("SELECT COUNT(*) AS n FROM simulacros").get().n,

    /**
     * Guarda un simulacro. Los aciertos se recalculan aquí desde las opciones correctas.
     * Los fallos entran en `progreso` (caja -2, vence hoy); los aciertos solo suman contador.
     * Con `clave_idempotencia`, repetir el POST devuelve el simulacro ya guardado.
     */
    crearSimulacro: db.transaction(
      ({ temas, segundos, penalizacion, respuestas, clave_idempotencia = null }, hoy = hoyIso()) => {
        if (clave_idempotencia) {
          const existente = db.query("SELECT * FROM simulacros WHERE clave_idempotencia = ?").get(clave_idempotencia);
          if (existente) return normalizarSimulacro(existente);
        }
        const ids = respuestas.map((r) => r.id);
        const filas = db
          .query(
            `SELECT pregunta_id, posicion FROM opciones
         WHERE es_correcta = 1 AND pregunta_id IN (${marcas(ids.length)})`,
          )
          .all(...ids);
        const correctas = new Map(filas.map((f) => [f.pregunta_id, f.posicion]));
        const detalle = [];
        let aciertos = 0,
          fallos = 0,
          enBlanco = 0;
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
        const info = db
          .query(`
        INSERT INTO simulacros (temas, total, aciertos, fallos, en_blanco, penalizacion, puntos, segundos, detalle, clave_idempotencia)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            JSON.stringify(temas),
            total,
            aciertos,
            fallos,
            enBlanco,
            penalizacion,
            puntos,
            segundos,
            JSON.stringify(detalle),
            clave_idempotencia,
          );
        return normalizarSimulacro(db.query("SELECT * FROM simulacros WHERE id = ?").get(Number(info.lastInsertRowid)));
      },
    ),

    listarSimulacros(limite = 20) {
      return db
        .query(`
        SELECT id, fecha, temas, total, aciertos, fallos, en_blanco, penalizacion, puntos, segundos
        FROM simulacros ORDER BY fecha DESC, id DESC LIMIT ?`)
        .all(limite)
        .map(normalizarSimulacro);
    },

    obtenerSimulacro(id) {
      return normalizarSimulacro(db.query("SELECT * FROM simulacros WHERE id = ?").get(id));
    },
  };
}
