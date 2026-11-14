/* Configuración compartida: constantes y reglas puras que usan servidor, núcleo local
   (Android/WebView) y cliente. Nada de entorno, filesystem ni APIs de Node aquí:
   este archivo se empaqueta también para el navegador (task 11). */

/* Reglas compartidas */
export const MIN_OPC = 2;
export const MAX_OPC = 8;
export const CAJA_MAX = 6;
export const CAJA_DOMINADA = 4;
export const MAX_BLOQUE = 120;
export const MAX_TEMA_NOMBRE = 500;
/* Longitud máxima de las etiquetas de los desplegables (se recortan con "..."). */
export const MAX_ETIQUETA = 60;
/* Tamaño máximo del cuerpo de una petición, en bytes (Fase 2.9). Se aplica en `Bun.serve`
   y también en `cuerpoJson`, que mide bytes y no caracteres. */
export const MAX_CUERPO = 2_000_000;

/* Límites diarios (Fase 3). El cupo lo calcula el servidor a partir de `respuestas`. */
export const CUPO_NUEVAS = 15; // preguntas nuevas que se introducen como máximo cada día
export const FRENO_ATRASO = 2; // si hay más de FRENO_ATRASO × CUPO_NUEVAS repasos atrasados, no entran nuevas
export const FACTOR_EXAMEN = 0.15; // tope de intervalo = FACTOR_EXAMEN × días hasta el examen (Fase 3.6)

/* Zona horaria para calcular «hoy» en el servidor (p. ej. Europe/Madrid). Vacío = zona del sistema. */
export const APP_TZ = process.env.APP_TZ ?? null;

/**
 * Decide si hay que importar el banco al arrancar. Función pura.
 * Con `auto` y sin `OPIOS_PREGUNTAS`, solo importa si la BD está vacía: evita meter el banco de
 * ejemplo en una BD real por haber olvidado la variable.
 */
export function debeImportar(modo, bdVacia, hayVariable) {
    if (modo === "no") return false;
    if (modo === "vacia") return bdVacia;
    if (modo === "auto") return hayVariable || bdVacia;
    throw new Error(`OPIOS_SEED no válido: «${modo}» (valores admitidos: vacia, auto, no).`);
}