import { existsSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const PUBLIC_DIR = join(ROOT, "public");

/* Banco de preguntas (Fase 8.1). `preguntas/` es el banco propio (o el clon del repo del banco);
   `ejemplo/` es la muestra que trae la app para que arranque sin configurar nada. */
export const DIR_PREGUNTAS_POR_DEFECTO = join(ROOT, "preguntas");
export const DIR_EJEMPLO = join(ROOT, "ejemplo");

/**
 * Decide qué directorio de preguntas usar. Función pura: recibe las variables de entorno y un
 * comprobador de existencia, de modo que se puede probar sin tocar el sistema de archivos.
 * - Si `OPIOS_PREGUNTAS` está definida, manda: si la carpeta no existe, se lanza un error claro.
 * - Si no, se usa `preguntas/` cuando existe y `ejemplo/` en caso contrario.
 */
export function resolverDirPreguntas(env = {}, existe = () => false) {
    const indicado = String(env.OPIOS_PREGUNTAS ?? "").trim();
    if (indicado) {
        if (!existe(indicado))
            throw new Error(
                `OPIOS_PREGUNTAS apunta a «${indicado}», que no existe. Corrige la ruta o quita la variable.`,
            );
        return indicado;
    }
    return existe(DIR_PREGUNTAS_POR_DEFECTO) ? DIR_PREGUNTAS_POR_DEFECTO : DIR_EJEMPLO;
}

export const DIR_PREGUNTAS = resolverDirPreguntas(process.env, (p) => existsSync(p));

export const PORT = Number(process.env.PORT ?? 8000);
// Solo accesible desde esta máquina.
export const HOST = process.env.HOST ?? "127.0.0.1";
/* Nombres de host aceptados en la cabecera `Host` (mitiga DNS rebinding). Los de ALLOWED_HOSTS se suman al loopback. */
const HOSTS_POR_DEFECTO = ["localhost", "127.0.0.1", "[::1]", "::1"];
const HOSTS_EXTRA = (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
export const ALLOWED_HOSTS = [...new Set([...HOSTS_POR_DEFECTO, ...HOSTS_EXTRA])];
// Si se escucha en una IP concreta (p. ej. HOST=192.168.1.5), también se acepta esa.
if (HOST && HOST !== "0.0.0.0" && HOST !== "::" && !ALLOWED_HOSTS.includes(HOST.toLowerCase()))
    ALLOWED_HOSTS.push(HOST.toLowerCase());
// Si se definen ambas, la app pide usuario y contraseña (HTTP Basic). Imprescindible si se publica en internet.
export const AUTH =
    process.env.AUTH_USER && process.env.AUTH_PASS
        ? { usuario: process.env.AUTH_USER, clave: process.env.AUTH_PASS }
        : null;
export const DB_PATH = process.env.OPIOS_DB ?? join(ROOT, "data", "opios.db");
// Zona horaria para calcular «hoy» en el servidor (p. ej. Europe/Madrid). Vacío = zona del sistema.
export const APP_TZ = process.env.APP_TZ ?? null;

/* Modo de importación al arrancar (Fase 8.2): `vacia` (solo si la BD no tiene preguntas),
   `auto` (en cada arranque, con --actualizar) o `no` (nunca). */
export const OPIOS_SEED = String(process.env.OPIOS_SEED ?? "vacia")
    .trim()
    .toLowerCase();

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
