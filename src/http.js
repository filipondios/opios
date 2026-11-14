/* Adaptador HTTP para Bun: archivos estáticos (`Bun.file`), gzip (`Bun.gzipSync`),
   control de `Host`, autenticación Basic y cabeceras de seguridad. Es lo único del
   núcleo que puede tocar APIs de Bun; la capa Capacitor (Android) lo sustituirá. */
import { join, normalize, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { ALLOWED_HOSTS, PUBLIC_DIR } from "./config.js";
import { ErrorApi } from "./errores.js";
import { aTexto } from "./views/html.js";
import { paginaNoEncontrada } from "./views/error.js";

const paginaNoEncontradaHtml = (ruta) =>
    new Response(aTexto(paginaNoEncontrada(ruta)), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });

function igual(a, b) {
    const x = Buffer.from(a),
        y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

/** Nombre de host de la petición, sin el puerto (`[::1]:8000` -> `[::1]`).
    En peticiones reales manda la cabecera `Host`; si falta (p. ej. en tests), se usa el de la URL. */
function hostDe(req) {
    const host = (req.headers.get("host") ?? new URL(req.url).host ?? "").trim().toLowerCase();
    return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

/** Rechaza peticiones cuyo `Host` no esté en la lista permitida (protección contra DNS rebinding). */
function hostPermitido(req) {
    return ALLOWED_HOSTS.includes(hostDe(req));
}

const COMPRIMIBLE = /^(text\/|application\/json|application\/javascript|application\/xml|image\/svg)/;
const MIN_COMPRIMIR = 1024; // por debajo, comprimir no compensa

/**
 * Comprime con gzip las respuestas de texto cuando el cliente lo acepta (Fase 4.4).
 * Devuelve siempre una respuesta nueva (el cuerpo original se consume aquí).
 */
async function comprimir(req, res) {
    if (!res || req.method === "HEAD" || res.status === 204 || res.status === 304 || !res.body) return res;
    const tipo = res.headers.get("content-type") ?? "";
    if (!COMPRIMIBLE.test(tipo) || res.headers.has("content-encoding")) return res;
    const buf = Buffer.from(await res.arrayBuffer());
    const aceptaGzip = (req.headers.get("accept-encoding") ?? "").toLowerCase().includes("gzip");
    if (!aceptaGzip || buf.length < MIN_COMPRIMIR) {
        const h = new Headers(res.headers);
        h.append("Vary", "Accept-Encoding");
        return new Response(buf, { status: res.status, statusText: res.statusText, headers: h });
    }
    const comprimido = Bun.gzipSync(buf);
    const h = new Headers(res.headers);
    h.set("Content-Encoding", "gzip");
    h.set("Content-Length", String(comprimido.length));
    h.append("Vary", "Accept-Encoding");
    return new Response(comprimido, { status: res.status, statusText: res.statusText, headers: h });
}

/** Archivos de `public/`; null si no existen o la ruta se sale del directorio (path traversal). */
async function estatico(req, ruta) {
    const archivo = join(PUBLIC_DIR, normalize(ruta));
    if (!archivo.startsWith(PUBLIC_DIR + sep)) return null;
    const f = Bun.file(archivo);
    if (!(await f.exists())) return null;
    /* Fuentes e imágenes no cambian: se cachean para siempre. El resto se revalida (los nombres no llevan hash). */
    const cache = /\.(woff2?|ttf|otf|png|jpe?g|gif|svg|ico)$/i.test(archivo)
        ? "public, max-age=31536000, immutable"
        : "no-cache";
    /* ETag débil con tamaño y mtime: una petición condicional ahorra el cuerpo entero (Fase 2.2). */
    const etag = `W/"${f.size}-${Math.floor(f.lastModified)}"`;
    const inm = req.headers.get("if-none-match");
    if (inm && inm.split(",").some((v) => v.trim() === etag))
        return new Response(null, { status: 304, headers: { "Cache-Control": cache, ETag: etag } });
    return new Response(f, { headers: { "Cache-Control": cache, ETag: etag } });
}

/**
 * Une API, web y estáticos en un único manejador de peticiones.
 * Con `auth = { usuario, clave }` se exige autenticación HTTP Basic en todo salvo /healthz.
 */
export function crearManejadorHttp({ api, web, auth = null }) {
    async function responder(req, url, ruta) {
        if (!hostPermitido(req)) return new Response("Host no permitido.", { status: 403 });
        if (ruta === "/healthz") return new Response("ok", { headers: { "Cache-Control": "no-store" } });
        if (auth) {
            const m = /^Basic (.+)$/.exec(req.headers.get("authorization") ?? "");
            const [u = "", ...resto] = m ? Buffer.from(m[1], "base64").toString().split(":") : [];
            if (!(m && igual(u, auth.usuario) && igual(resto.join(":"), auth.clave)))
                return new Response("Autenticación necesaria", {
                    status: 401,
                    headers: { "WWW-Authenticate": 'Basic realm="opios", charset="UTF-8"' },
                });
        }
        if (ruta.startsWith("/api/")) return await api(req, url, ruta);
        if (req.method === "GET" || req.method === "HEAD") {
            return (await web(ruta)) ?? (await estatico(req, ruta)) ?? paginaNoEncontradaHtml(ruta);
        }
        return new Response("Método no permitido", { status: 405 });
    }

    /* Cabeceras de seguridad en todas las respuestas (Fase 2.3): la validación de `Host` no impide
       que otra web incruste la app en un iframe. `nosniff` y `no-referrer` son defensa en profundidad. */
    const SEGURIDAD = {
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    };
    function conSeguridad(res) {
        if (!res) return res;
        const h = new Headers(res.headers);
        for (const [k, v] of Object.entries(SEGURIDAD)) if (!h.has(k)) h.set(k, v);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }

    const jsonError = (datos, status) =>
        Response.json(datos, { status, headers: { "Cache-Control": "no-store" } });

    return async function manejar(req) {
        const url = new URL(req.url);
        try {
            return conSeguridad(await comprimir(req, await responder(req, url, url.pathname)));
        } catch (e) {
            if (e instanceof ErrorApi) return conSeguridad(jsonError({ error: e.message, ...e.extra }, e.status));
            console.error(new Date().toISOString(), e);
            return conSeguridad(jsonError({ error: "Error interno del servidor." }, 500));
        }
    };
}
