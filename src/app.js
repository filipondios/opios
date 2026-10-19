import { join, normalize, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { PUBLIC_DIR, CAJA_DOMINADA } from "./config.js";
import { ErrorApi } from "./errores.js";
import { hoyIso } from "./fechas.js";
import { validarPregunta, validarProgreso } from "./validar.js";
import { serializarJson } from "./exportar.js";
import { aTexto } from "./views/html.js";
import { paginaHome, temasGrid } from "./views/home.js";
import { paginaMaker } from "./views/maker.js";

const json = (datos, status = 200) => Response.json(datos, { status, headers: { "Cache-Control": "no-store" } });
const pagina = (r) => new Response(aTexto(r), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

/** Cuerpo JSON de una petición de escritura. Exigir application/json impide los envíos cruzados desde formularios de otras webs. */
async function cuerpoJson(req) {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
    throw new ErrorApi(415, "El cuerpo debe ser application/json.");
  const texto = await req.text();
  if (texto.length > 2_000_000) throw new ErrorApi(413, "Cuerpo demasiado grande.");
  try { return JSON.parse(texto); } catch { throw new ErrorApi(400, "JSON no válido."); }
}

/** Entero positivo o null (para ids y parámetros opcionales). */
function entero(v, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}

function igual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Crea el manejador de peticiones (independiente del puerto, así se puede probar sin red).
 * Con `auth = { usuario, clave }` se exige autenticación HTTP Basic en todo salvo /healthz.
 */
export function crearApp(repo, { auth = null } = {}) {
  const estadisticas = () => repo.estadisticasTemas(hoyIso(), CAJA_DOMINADA);

  async function api(req, url, ruta) {
    const m = req.method;

    if (ruta === "/api/temas" && m === "GET") {
      return json(estadisticas().map(({ tema, total }) => ({ tema, total })));
    }

    if (ruta === "/api/test" && m === "GET") {
      const temas = (url.searchParams.get("temas") ?? "").split(",").filter(Boolean).map(Number);
      if (!temas.length || temas.some((t) => !Number.isInteger(t) || t < 0)) throw new ErrorApi(400, "Indica los temas: ?temas=1,2,3");
      return json(repo.paraTest([...new Set(temas)]));
    }

    if (ruta === "/api/progreso") {
      if (m === "POST") {
        const cuerpo = await cuerpoJson(req);
        if (!Array.isArray(cuerpo) || cuerpo.length > 5000) throw new ErrorApi(400, "Se esperaba una lista de entradas de progreso.");
        repo.guardarProgreso(cuerpo.map(validarProgreso));
        return json({ guardadas: cuerpo.length });
      }
      if (m === "DELETE") { repo.reiniciarProgreso(); return json({ ok: true }); }
    }

    if (ruta === "/api/exportar" && m === "GET") {
      return new Response(serializarJson(repo.todas()), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="preguntas.json"' },
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
        if (!repo.actualizar(id, validarPregunta(await cuerpoJson(req)))) throw new ErrorApi(404, "La pregunta no existe.");
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
    if (!archivo.startsWith(PUBLIC_DIR + sep)) return new Response("No encontrado", { status: 404 });
    const f = Bun.file(archivo);
    if (!(await f.exists())) return new Response("No encontrado", { status: 404 });
    return new Response(f, { headers: { "Cache-Control": "no-cache" } });
  }

  return async function manejar(req) {
    const url = new URL(req.url);
    const ruta = url.pathname;
    try {
      if (ruta === "/healthz") return new Response("ok", { headers: { "Cache-Control": "no-store" } });
      if (auth) {
        const m = /^Basic (.+)$/.exec(req.headers.get("authorization") ?? "");
        const [u = "", ...resto] = m ? Buffer.from(m[1], "base64").toString().split(":") : [];
        if (!(m && igual(u, auth.usuario) && igual(resto.join(":"), auth.clave)))
          return new Response("Autenticación necesaria", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="opios", charset="UTF-8"' } });
      }
      if (ruta.startsWith("/api/")) return await api(req, url, ruta);
      if (req.method === "GET" || req.method === "HEAD") {
        if (ruta === "/") return pagina(paginaHome({ temas: estadisticas() }));
        if (ruta === "/maker") return pagina(paginaMaker({ temas: estadisticas() }));
        if (ruta === "/fragmentos/temas") return pagina(temasGrid(estadisticas()));
        return await estatico(ruta);
      }
      return new Response("Método no permitido", { status: 405 });
    } catch (e) {
      if (e instanceof ErrorApi) return json({ error: e.message, ...e.extra }, e.status);
      console.error(e);
      return json({ error: "Error interno del servidor." }, 500);
    }
  };
}
