import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
export const PUBLIC_DIR = join(ROOT, "public");
export const DIR_PREGUNTAS = join(ROOT, "preguntas");

export const PORT = Number(process.env.PORT ?? 8000);
// Solo accesible desde esta máquina. Usa HOST=0.0.0.0 para abrirlo a la red local.
export const HOST = process.env.HOST ?? "127.0.0.1";
export const DB_PATH = process.env.OPIOS_DB ?? join(ROOT, "data", "opios.db");

/* Reglas compartidas */
export const MIN_OPC = 2;
export const MAX_OPC = 8;
export const CAJA_MAX = 6;       // cajas 0..6 del repaso espaciado (ver INTERVALOS_DIAS en public/js/test.js)
export const CAJA_DOMINADA = 4;  // desde esta caja una pregunta cuenta como dominada
