import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const PUBLIC_DIR = join(ROOT, "public");
export const DIR_PREGUNTAS = join(ROOT, "preguntas");

export const PORT = Number(process.env.PORT ?? 8000);
// Solo accesible desde esta máquina.
export const HOST = process.env.HOST ?? "127.0.0.1";
// Si se definen ambas, la app pide usuario y contraseña (HTTP Basic). Imprescindible si se publica en internet.
export const AUTH = process.env.AUTH_USER && process.env.AUTH_PASS
  ? { usuario: process.env.AUTH_USER, clave: process.env.AUTH_PASS } : null;
export const DB_PATH = process.env.OPIOS_DB ?? join(ROOT, "data", "opios.db");

/* Reglas compartidas */
export const MIN_OPC = 2;
export const MAX_OPC = 8;
export const CAJA_MAX = 6;
export const CAJA_DOMINADA = 4;
export const MAX_BLOQUE = 120;
export const MAX_TEMA_NOMBRE = 200;
/* Longitud máxima de las etiquetas de los desplegables (se recortan con "..."). */
export const MAX_ETIQUETA = 60;