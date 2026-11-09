/* Lógica pura del simulacro: preparación de preguntas, mapeo de índices y reloj.
   Sin DOM, para poder probarla con bun:test. */

import { barajar } from "./comun.js";

/**
 * Baraja las preguntas y sus opciones, y guarda en `originales` el índice original
 * de cada opción mostrada. `azar` se inyecta para que los tests sean deterministas.
 */
export function prepararPreguntas(preguntas, { n = Infinity, azar = Math.random } = {}) {
    return barajar(preguntas, azar)
        .slice(0, n)
        .map((q) => {
            const orden = barajar(
                q.respuestas.map((_, k) => k),
                azar,
            );
            return {
                id: q.id,
                tema: q.tema,
                temaNumero: q.tema_numero ?? q.tema,
                bloque: q.bloque_nombre ?? "",
                temaNombre: q.tema_nombre ?? "",
                pregunta: q.pregunta,
                opciones: orden.map((k) => q.respuestas[k]),
                originales: orden,
                correcta: orden.indexOf(q.correcta),
                explicacion: q.explicacion,
            };
        });
}

/** Índice elegido en el orden barajado -> índice original de la opción. */
export function indiceOriginal(pregunta, elegida) {
    if (elegida == null || elegida < 0) return -1;
    return pregunta.originales[elegida] ?? -1;
}

/** Respuestas de un simulacro en el formato que espera el servidor. */
export function respuestasParaGuardar(preguntas, respuestas) {
    return preguntas.map((q, i) => ({ id: q.id, elegida: indiceOriginal(q, respuestas[i]) }));
}

/** Estado del reloj en un instante dado. */
export function estadoReloj(fin, ahora = Date.now()) {
    const restante = Math.max(0, fin - ahora);
    const segundos = Math.ceil(restante / 1000);
    return { restante, segundos, agotado: restante <= 0, bajo: segundos <= 300 };
}

/** Formatea segundos como MM:SS (sin horas; los simulacros duran minutos). */
export function mmss(segundos) {
    const s = Math.max(0, Math.round(segundos));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

/**
 * Elige los temas con menor precisión conocida (aciertos / respuestas) para el perfil
 * «Temas débiles». Los temas sin datos no se preseleccionan: no hay evidencia de debilidad.
 */
export function temasDebiles(temas, limite = 5) {
    return temas
        .filter((t) => Number(t.precision) >= 0)
        .sort((a, b) => Number(a.precision) - Number(b.precision) || Number(a.id) - Number(b.id))
        .slice(0, Math.max(1, limite))
        .map((t) => Number(t.id));
}
