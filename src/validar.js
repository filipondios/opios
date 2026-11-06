import { ErrorApi } from "./errores.js";
import { MIN_OPC, MAX_OPC, CAJA_MAX, MAX_BLOQUE, MAX_TEMA_NOMBRE } from "./config.js";

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

  /* Metadatos opcionales del temario (los usa la importación/exportación por bloques). */
  let bloque = null, temaNumero = null, bloqueNumero = null;
  if (b.bloque_numero != null && String(b.bloque_numero).trim() !== "") {
    bloqueNumero = Number(b.bloque_numero);
    if (!Number.isInteger(bloqueNumero) || bloqueNumero <= 0) throw mal("El número de bloque no es válido.");
  }
  if (b.bloque != null && String(b.bloque).trim() !== "") {
    bloque = texto(b.bloque);
    if (bloque.length > MAX_BLOQUE) throw mal("El nombre del bloque es demasiado largo.");
  }
  if (bloque != null || bloqueNumero != null) {
    if (!bloque) bloque = `Bloque ${bloqueNumero}`;
    temaNumero = Number(b.tema_numero ?? b.tema);
    if (!Number.isInteger(temaNumero) || temaNumero < 0 || temaNumero > MAX_TEMA)
      throw mal("El número de tema no es válido.");
  }
  return { tema, bloque, bloque_numero: bloqueNumero, tema_numero: temaNumero, pregunta, respuestas, correcta, explicacion };
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
  return validarPregunta({
    tema: p.tema, bloque: p.bloque, bloque_numero: p.bloque_numero, tema_numero: p.tema_numero,
    pregunta: p.pregunta, respuestas: p.respuestas, correcta, explicacion: p.explicacion,
  }, { estricto: false });
}

/** Valida el nombre de un bloque del temario. */
export function validarBloque(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw mal("El cuerpo debe ser un objeto.");
  const nombre = texto(b.nombre);
  if (!nombre) throw mal("Falta el nombre del bloque.");
  if (nombre.length > MAX_BLOQUE) throw mal("El nombre del bloque es demasiado largo.");
  return { nombre };
}

/** Valida un tema del temario: { bloque, numero, nombre }. */
export function validarTema(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw mal("El cuerpo debe ser un objeto.");
  const bloque = Number(b.bloque);
  if (!Number.isInteger(bloque) || bloque <= 0) throw mal("Elige un bloque válido.");
  const numero = Number(b.numero);
  if (!Number.isInteger(numero) || numero < 0 || numero > MAX_TEMA)
    throw mal("El número de tema debe ser un entero entre 0 y " + MAX_TEMA + ".");
  const nombre = texto(b.nombre);
  if (nombre.length > MAX_TEMA_NOMBRE) throw mal("El nombre del tema es demasiado largo.");
  return { bloque, numero, nombre };
}

/** Valida el `info.json` de un bloque: { nombre, temas: [{ numero, titulo }] }. */
export function validarInfoBloque(info) {
  if (!info || typeof info !== "object" || Array.isArray(info)) throw mal("info.json debe ser un objeto.");
  const nombre = texto(info.nombre);
  if (!nombre) throw mal("Falta el nombre del bloque en info.json.");
  if (nombre.length > MAX_BLOQUE) throw mal("El nombre del bloque es demasiado largo.");
  if (info.temas != null && !Array.isArray(info.temas)) throw mal("«temas» debe ser una lista en info.json.");
  const temas = (info.temas ?? []).map((t, i) => {
    if (!t || typeof t !== "object" || Array.isArray(t)) throw mal(`El tema #${i + 1} de info.json no es válido.`);
    const numero = Number(t.numero);
    if (!Number.isInteger(numero) || numero < 0 || numero > MAX_TEMA)
      throw mal(`El número del tema #${i + 1} de info.json no es válido.`);
    const titulo = texto(t.titulo);
    if (!titulo) throw mal(`Falta el título del tema ${numero} en info.json.`);
    if (titulo.length > MAX_TEMA_NOMBRE) throw mal(`El título del tema ${numero} es demasiado largo.`);
    return { numero, titulo };
  });
  const vistos = new Set();
  for (const t of temas) {
    if (vistos.has(t.numero)) throw mal(`El tema ${t.numero} aparece dos veces en info.json.`);
    vistos.add(t.numero);
  }
  return { nombre, temas };
}

/** Valida el resultado de un simulacro: { temas, segundos, penalizacion, respuestas: [{ id, elegida }] }. */
export function validarSimulacro(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw mal("El cuerpo debe ser un objeto.");
  if (!Array.isArray(b.temas) || b.temas.length === 0 || b.temas.length > 5000)
    throw mal("Indica al menos un tema para el simulacro.");
  const temas = b.temas.map(Number);
  if (temas.some((t) => !Number.isInteger(t) || t < 0)) throw mal("Hay un tema no válido.");
  const segundos = Number(b.segundos);
  if (!Number.isInteger(segundos) || segundos < 0 || segundos > 86_400)
    throw mal("El tiempo del simulacro no es válido.");
  const penalizacion = Number(b.penalizacion);
  if (!Number.isFinite(penalizacion) || penalizacion < 0 || penalizacion > 1)
    throw mal("La penalización debe estar entre 0 y 1.");
  if (!Array.isArray(b.respuestas) || b.respuestas.length < 1 || b.respuestas.length > 500)
    throw mal("Hacen falta entre 1 y 500 respuestas.");
  const respuestas = b.respuestas.map((e) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) throw mal("Respuesta de simulacro no válida.");
    const id = Number(e.id);
    const elegida = e.elegida == null || e.elegida === "" ? -1 : Number(e.elegida);
    if (!Number.isInteger(id) || id <= 0) throw mal("Identificador de pregunta no válido.");
    if (!Number.isInteger(elegida) || elegida < -1 || elegida >= MAX_OPC) throw mal("Opción elegida no válida.");
    return { id, elegida };
  });
  if (new Set(respuestas.map((r) => r.id)).size !== respuestas.length)
    throw mal("Hay preguntas repetidas en el simulacro.");
  const clave = b.clave_idempotencia;
  if (clave != null && (typeof clave !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(clave)))
    throw mal("La clave de idempotencia no es válida.");
  return { temas: [...new Set(temas)], segundos, penalizacion, respuestas, clave_idempotencia: clave ?? null };
}

/** Valida el cuerpo de ajustes: { fecha_examen: "AAAA-MM-DD" | "" }. */
export function validarAjustes(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw mal("El cuerpo debe ser un objeto.");
  const fecha = b.fecha_examen;
  if (fecha != null && String(fecha).trim() !== "") {
    const d = typeof fecha === "string" ? new Date(fecha + "T00:00:00Z") : null;
    const valida = typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha)
      && d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
    if (!valida) throw mal("La fecha de examen no es válida (usa AAAA-MM-DD).");
    return { fecha_examen: fecha };
  }
  return { fecha_examen: null };
}

/** Valida un lote de respuestas del test: [{ id, acierto, ms? }]. */export function validarRespuestas(b) {
  if (!Array.isArray(b) || b.length === 0 || b.length > 5000)
    throw mal("Se esperaba una lista de respuestas.");
  return b.map((e) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) throw mal("Respuesta no válida.");
    const id = Number(e.id);
    if (!Number.isInteger(id) || id <= 0) throw mal("Identificador de pregunta no válido.");
    const r = e.acierto;
    const acierto = r === true || r === 1 ? 1 : r === false || r === 0 ? 0 : null;
    if (acierto === null) throw mal("El resultado de la respuesta no es válido.");
    const ms = e.ms == null || e.ms === "" ? null : Number(e.ms);
    if (ms !== null && (!Number.isInteger(ms) || ms < 0 || ms > 3_600_000))
      throw mal("El tiempo de respuesta no es válido.");
    return { id, acierto, ms };
  });
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
