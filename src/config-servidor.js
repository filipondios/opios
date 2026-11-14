/* Configuración solo del servidor/CLI (Node): entorno, rutas del filesystem y seguridad
   HTTP. El núcleo compartido usa `src/config.js`; esto NO se empaqueta para el navegador. */
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
/* Modo biblioteca (task 6): con `OPIOS_CATALOGO` la app abre el banco activo del catálogo
   (DatabaseManager) en lugar del modo directo `OPIOS_DB`. Vacío = modo directo (legacy). */
export const RUTA_CATALOGO = (process.env.OPIOS_CATALOGO ?? "").trim();

/* Modo de importación al arrancar (Fase 8.2): `vacia` (solo si la BD no tiene preguntas),
   `auto` (en cada arranque, con --actualizar) o `no` (nunca). La decisión pura (debeImportar)
   vive en `src/config.js`, que también usa el núcleo local. */
export const OPIOS_SEED = String(process.env.OPIOS_SEED ?? "vacia")
    .trim()
    .toLowerCase();
