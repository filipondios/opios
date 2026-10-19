import { ErrorApi } from "./errores.js";
import { MIN_OPC, MAX_OPC, CAJA_MAX } from "./config.js";

const LETRAS = "abcdefgh";
const MAX_TEMA = 9999, MAX_ENUNCIADO = 2000, MAX_OPCION = 1000, MAX_EXPLICACION = 4000;

/** Texto sin espacios repetidos: identifica una pregunta para detectar duplicados. */
export const claveDe = (enunciado) => enunciado.replace(/\s+/g, " ").trim();

const mal = (msg) => new ErrorApi(400, msg);
const texto = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * Valida el cuerpo de una pregunta tal y como lo envía el creador:
 * { tema, pregunta, respuestas: string[], correcta: índice (0..n-1), explicacion }
 * Con `estricto: false` se admiten opciones repetidas (datos antiguos de los JSON).
 */
export function validarPregunta(b, { estricto = true } = {}) {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw mal("El cuerpo debe ser un objeto.");
  const tema = Number(b.tema);
  if (b.tema === "" || b.tema == null || !Number.isInteger(tema) || tema < 0 || tema > MAX_TEMA)
    throw mal("El tema debe ser un número entero (0 o más).");
  const pregunta = texto(b.pregunta);
  if (!pregunta) throw mal("Falta la pregunta.");
  if (pregunta.length > MAX_ENUNCIADO) throw mal("La pregunta es demasiado larga.");
  if (!Array.isArray(b.respuestas) || b.respuestas.length < MIN_OPC || b.respuestas.length > MAX_OPC)
    throw mal(`Hacen falta entre ${MIN_OPC} y ${MAX_OPC} opciones.`);
  const respuestas = b.respuestas.map((r) => (typeof r === "string" ? r.trim() : String(r ?? "").trim()));
  if (respuestas.some((r) => !r)) throw mal("Hay una opción vacía.");
  if (respuestas.some((r) => r.length > MAX_OPCION)) throw mal("Hay una opción demasiado larga.");
  if (estricto) {
    const vistas = new Set();
    for (const r of respuestas) {
      const k = r.toLowerCase();
      if (vistas.has(k)) throw mal(`Hay dos opciones iguales: «${r}».`);
      vistas.add(k);
    }
  }
  const correcta = Number(b.correcta);
  if (!Number.isInteger(correcta) || correcta < 0 || correcta >= respuestas.length)
    throw mal("La respuesta correcta no corresponde a ninguna opción.");
  const explicacion = texto(b.explicacion);
  if (explicacion.length > MAX_EXPLICACION) throw mal("La explicación es demasiado larga.");
  return { tema, pregunta, respuestas, correcta, explicacion };
}

/** Convierte una pregunta del formato JSON antiguo (`respuesta_correcta` = letra) al formato interno. */
export function desdeJsonAntiguo(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw mal("no es un objeto");
  let correcta = 0; // como antes: sin respuesta_correcta, la correcta es la A
  const rc = p.respuesta_correcta;
  if (rc != null && String(rc).trim() !== "") {
    const s = String(rc).trim();
    const n = LETRAS.indexOf(s.toLowerCase());
    if (/^[a-z]$/i.test(s) && n >= 0 && Array.isArray(p.respuestas) && n < p.respuestas.length) correcta = n;
    else {
      correcta = Array.isArray(p.respuestas) ? p.respuestas.map((x) => String(x).trim()).indexOf(s) : -1;
      if (correcta < 0) throw mal("'respuesta_correcta' debe ser una letra (a, b, c...) que corresponda a una opción");
    }
  }
  return validarPregunta({ tema: p.tema, pregunta: p.pregunta, respuestas: p.respuestas, correcta, explicacion: p.explicacion }, { estricto: false });
}

/** Valida una entrada de progreso enviada por el test. */
export function validarProgreso(e) {
  if (!e || typeof e !== "object") throw mal("Entrada de progreso no válida.");
  const { id, caja, aciertos, fallos, vence } = e;
  if (!Number.isInteger(id) || id <= 0) throw mal("Identificador de pregunta no válido.");
  if (!Number.isInteger(caja) || caja < 0 || caja > CAJA_MAX) throw mal("Caja fuera de rango.");
  if (!Number.isInteger(aciertos) || aciertos < 0 || !Number.isInteger(fallos) || fallos < 0) throw mal("Contadores no válidos.");
  if (typeof vence !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(vence)) throw mal("Fecha de repaso no válida.");
  return { id, caja, vence, aciertos, fallos };
}
