import { join, normalize, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { PUBLIC_DIR, CAJA_DOMINADA, APP_TZ, FACTOR_EXAMEN, ALLOWED_HOSTS } from "./config.js";
import { ErrorApi } from "./errores.js";
import { hoyIso, sumarDias, diasEntre } from "./fechas.js";
import {
    validarPregunta,
    validarProgreso,
    validarRespuestas,
    validarBloque,
    validarTema,
    validarSimulacro,
    validarAjustes,
} from "./validar.js";
import { serializarJson } from "./exportar.js";
import { aTexto } from "./views/html.js";
import { paginaHome, temasGrid } from "./views/home.js";
import { paginaMaker } from "./views/maker.js";
import { paginaTemario } from "./views/temario.js";
import { paginaEstadisticas } from "./views/estadisticas.js";
import { paginaSimulacro } from "./views/simulacro.js";
import { paginaNoEncontrada } from "./views/error.js";

const json = (datos, status = 200) => Response.json(datos, { status, headers: { "Cache-Control": "no-store" } });
const pagina = (r, status = 200) =>
    new Response(aTexto(r), {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });

/** Cuerpo JSON de una petición de escritura. Exigir application/json impide los envíos cruzados desde formularios de otras webs. */
async function cuerpoJson(req) {
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
        throw new ErrorApi(415, "El cuerpo debe ser application/json.");
    const texto = await req.text();
    if (texto.length > 2_000_000) throw new ErrorApi(413, "Cuerpo demasiado grande.");
    try {
        return JSON.parse(texto);
    } catch {
        throw new ErrorApi(400, "JSON no válido.");
    }
}

/** Entero positivo o null (para ids y parámetros opcionales). */
function entero(v, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}

/** Lista de ids que envía el cliente para reordenar (bloques, por ejemplo). */
function idsDe(cuerpo) {
    if (!cuerpo || !Array.isArray(cuerpo.ids) || cuerpo.ids.length > 5000)
        throw new ErrorApi(400, "Se esperaba un objeto con una lista de ids.");
    if (cuerpo.ids.some((id) => !Number.isInteger(id) || id <= 0))
        throw new ErrorApi(400, "La lista contiene identificadores no válidos.");
    return cuerpo.ids;
}

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

/**
 * Crea el manejador de peticiones (independiente del puerto, así se puede probar sin red).
 * Con `auth = { usuario, clave }` se exige autenticación HTTP Basic en todo salvo /healthz.
 * `ahora` devuelve la fecha actual; los tests la fijan para calcular repasos «de hoy».
 * `zona` (por defecto `APP_TZ`) decide en qué zona horaria se calcula ese «hoy».
 */
export function crearApp(repo, { auth = null, ahora = () => new Date(), zona = APP_TZ } = {}) {
    const fechaHoy = () => hoyIso(ahora(), zona);
    const estadisticas = () => repo.estadisticasTemas(fechaHoy(), CAJA_DOMINADA);
    /** Temario con las cifras de repaso de cada tema (para barras y bloques plegables). */
    const temarioConProgreso = () => {
        const porTema = new Map(estadisticas().map((e) => [e.tema, e]));
        return repo.temario().map((b) => ({
            ...b,
            temas: b.temas.map((t) => ({ ...t, ...(porTema.get(t.id) ?? {}) })),
        }));
    };

    /**
     * Fecha de examen y tope de intervalo asociado (Fase 3.6): el intervalo de repaso no debe
     * superar ~FACTOR_EXAMEN del tiempo que queda, según Cepeda et al. (2008).
     */
    function infoExamen() {
        const { fecha_examen: fecha } = repo.ajustes();
        if (!fecha) return { fecha: null, dias: null, topeDias: 0 };
        const dias = diasEntre(fechaHoy(), fecha);
        if (dias <= 0) return { fecha, dias, topeDias: 0 };
        return { fecha, dias, topeDias: Math.max(1, Math.round(FACTOR_EXAMEN * dias)) };
    }

    async function api(req, url, ruta) {
        const m = req.method;

        if (ruta === "/api/temas" && m === "GET") {
            return json(estadisticas().map(({ tema, total }) => ({ tema, total })));
        }

        /* --- Temario: bloques y temas --- */
        if (ruta === "/api/temario" && m === "GET") return json(temarioConProgreso());

        if (ruta === "/api/bloques" && m === "POST")
            return json(repo.crearBloque(validarBloque(await cuerpoJson(req))), 201);

        if (ruta === "/api/bloques/reordenar" && m === "POST") {
            repo.reordenarBloques(idsDe(await cuerpoJson(req)));
            return json({ ok: true });
        }

        const mbloque = ruta.match(/^\/api\/bloques\/(\d+)$/);
        if (mbloque) {
            const id = Number(mbloque[1]);
            if (m === "PUT") {
                const b = repo.actualizarBloque(id, validarBloque(await cuerpoJson(req)));
                if (!b) throw new ErrorApi(404, "El bloque no existe.");
                return json(b);
            }
            if (m === "DELETE") {
                if (!repo.borrarBloque(id)) throw new ErrorApi(404, "El bloque no existe.");
                return new Response(null, { status: 204 });
            }
        }

        if (ruta === "/api/temas" && m === "POST") return json(repo.crearTema(validarTema(await cuerpoJson(req))), 201);

        const mtema = ruta.match(/^\/api\/temas\/(\d+)$/);
        if (mtema) {
            const id = Number(mtema[1]);
            if (m === "PUT") {
                const t = repo.actualizarTema(id, validarTema(await cuerpoJson(req)));
                if (!t) throw new ErrorApi(404, "El tema no existe.");
                return json(t);
            }
            if (m === "DELETE") {
                if (!repo.borrarTema(id)) throw new ErrorApi(404, "El tema no existe.");
                return new Response(null, { status: 204 });
            }
        }

        if (ruta === "/api/test" && m === "GET") {
            const temas = (url.searchParams.get("temas") ?? "").split(",").filter(Boolean).map(Number);
            if (!temas.length || temas.some((t) => !Number.isInteger(t) || t < 0))
                throw new ErrorApi(400, "Indica los temas: ?temas=1,2,3");
            return json({
                ...repo.paraTest([...new Set(temas)]),
                carga: repo.cargaDiaria(fechaHoy()),
                examen: infoExamen(),
            });
        }

        /* Ajustes de la instancia (fecha de examen). */
        if (ruta === "/api/ajustes") {
            if (m === "GET") return json({ ...repo.ajustes(), examen: infoExamen() });
            if (m === "PUT") {
                const { fecha_examen: fecha } = validarAjustes(await cuerpoJson(req));
                repo.guardarAjuste("fecha_examen", fecha);
                return json({ fecha_examen: fecha, examen: infoExamen() });
            }
        }

        /* Carga del día (cupo de nuevas y repasos pendientes); el cliente la muestra y la usa para limitar. */
        if (ruta === "/api/carga" && m === "GET") return json(repo.cargaDiaria(fechaHoy()));

        /* Registro de las respuestas del test (el simulacro escribe las suyas al guardarse). */
        if (ruta === "/api/respuestas" && m === "POST") {
            const cuerpo = await cuerpoJson(req);
            const lista = validarRespuestas(cuerpo && Array.isArray(cuerpo.respuestas) ? cuerpo.respuestas : cuerpo);
            return json({ registradas: repo.registrarRespuestas(lista, fechaHoy()) }, 201);
        }

        if (ruta === "/api/progreso") {
            if (m === "POST") {
                const cuerpo = await cuerpoJson(req);
                if (!Array.isArray(cuerpo) || cuerpo.length > 5000)
                    throw new ErrorApi(400, "Se esperaba una lista de entradas de progreso.");
                repo.guardarProgreso(cuerpo.map(validarProgreso));
                return json({ guardadas: cuerpo.length });
            }
            if (m === "DELETE") {
                repo.reiniciarProgreso();
                return json({ ok: true });
            }
        }

        if (ruta === "/api/simulacros") {
            if (m === "GET") {
                const limite = entero(url.searchParams.get("limite") ?? 20, { min: 1, max: 100 });
                if (Number.isNaN(limite)) throw new ErrorApi(400, "Parámetros no válidos.");
                return json(repo.listarSimulacros(limite));
            }
            if (m === "POST")
                return json(repo.crearSimulacro(validarSimulacro(await cuerpoJson(req)), fechaHoy()), 201);
        }

        const msim = ruta.match(/^\/api\/simulacros\/(\d+)$/);
        if (msim && m === "GET") {
            const s = repo.obtenerSimulacro(Number(msim[1]));
            if (!s) throw new ErrorApi(404, "El simulacro no existe.");
            return json(s);
        }

        if (ruta === "/api/exportar" && m === "GET") {
            return new Response(serializarJson(repo.todas()), {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "Content-Disposition": 'attachment; filename="preguntas.json"',
                },
            });
        }

        if (ruta === "/api/preguntas") {
            if (m === "GET") {
                const tema = entero(url.searchParams.get("tema"));
                const limite = entero(url.searchParams.get("limite") ?? 50, { min: 1, max: 200 });
                const desde = entero(url.searchParams.get("desde") ?? 0);
                if ([tema, limite, desde].some(Number.isNaN)) throw new ErrorApi(400, "Parámetros no válidos.");
                return json(repo.listar({ tema, texto: (url.searchParams.get("q") ?? "").trim(), limite, desde }));
            }
            if (m === "POST") {
                const id = repo.crear(validarPregunta(await cuerpoJson(req)));
                return json(repo.obtener(id), 201);
            }
        }

        const mid = ruta.match(/^\/api\/preguntas\/(\d+)$/);
        if (mid) {
            const id = Number(mid[1]);
            if (m === "GET") {
                const p = repo.obtener(id);
                if (!p) throw new ErrorApi(404, "La pregunta no existe.");
                return json(p);
            }
            if (m === "PUT") {
                if (!repo.actualizar(id, validarPregunta(await cuerpoJson(req))))
                    throw new ErrorApi(404, "La pregunta no existe.");
                return json(repo.obtener(id));
            }
            if (m === "DELETE") {
                if (!repo.borrar(id)) throw new ErrorApi(404, "La pregunta no existe.");
                return new Response(null, { status: 204 });
            }
        }

        throw new ErrorApi(404, "Ruta no encontrada.");
    }

    async function estatico(ruta) {
        const archivo = join(PUBLIC_DIR, normalize(ruta));
        if (!archivo.startsWith(PUBLIC_DIR + sep)) return null;
        const f = Bun.file(archivo);
        if (!(await f.exists())) return null;
        /* Fuentes e imágenes no cambian: se cachean para siempre. El resto se revalida (los nombres no llevan hash). */
        const cache = /\.(woff2?|ttf|otf|png|jpe?g|gif|svg|ico)$/i.test(archivo)
            ? "public, max-age=31536000, immutable"
            : "no-cache";
        return new Response(f, { headers: { "Cache-Control": cache } });
    }

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
            if (ruta === "/")
                return pagina(
                    paginaHome({ temas: estadisticas(), carga: repo.cargaDiaria(fechaHoy()), examen: infoExamen() }),
                );
            if (ruta === "/maker") return pagina(paginaMaker({ temario: repo.temario() }));
            if (ruta === "/temario") return pagina(paginaTemario());
            if (ruta === "/simulacro")
                return pagina(paginaSimulacro({ temario: repo.temario(), estadisticas: estadisticas() }));
            if (ruta === "/estadisticas") {
                const hoy = fechaHoy();
                return pagina(
                    paginaEstadisticas({
                        global: repo.estadisticasGlobales(hoy, CAJA_DOMINADA),
                        temas: estadisticas(),
                        prevision: repo.previsionRepasos(hoy, 7),
                        falladas: repo.preguntasMasFalladas(20),
                        actividad: repo.actividadReciente(sumarDias(hoy, -83)),
                        racha: repo.rachaDias(hoy),
                        semanas: repo.precisionSemanal(hoy, 8),
                        tiempo: repo.tiempoMedio(),
                        simulacros: repo.listarSimulacros(5),
                        totalSimulacros: repo.contarSimulacros(),
                        temario: repo.temario(),
                        hoy,
                        examen: infoExamen(),
                    }),
                );
            }
            if (ruta === "/fragmentos/temas") return pagina(temasGrid(estadisticas(), repo.cargaDiaria(fechaHoy())));
            const recurso = await estatico(ruta);
            return recurso ?? pagina(paginaNoEncontrada(ruta), 404);
        }
        return new Response("Método no permitido", { status: 405 });
    }

    return async function manejar(req) {
        const url = new URL(req.url);
        try {
            return await comprimir(req, await responder(req, url, url.pathname));
        } catch (e) {
            if (e instanceof ErrorApi) return json({ error: e.message, ...e.extra }, e.status);
            console.error(new Date().toISOString(), e);
            return json({ error: "Error interno del servidor." }, 500);
        }
    };
}
