import { MAX_CUERPO, MAX_SUBIDA, CAJA_DOMINADA } from "./config.js";
import { ErrorApi } from "./errores.js";
import {
    validarPregunta,
    validarProgreso,
    validarRespuestas,
    validarBloque,
    validarTema,
    validarSimulacro,
    validarAjustes,
} from "./validar.js";
import { serializarJson } from "./serializar.js";

const json = (datos, status = 200) => Response.json(datos, { status, headers: { "Cache-Control": "no-store" } });

/** Los errores del gestor llevan mensaje de usuario; lo que no, mensaje genérico. */
const msgErrorDe = (e) => (e instanceof Error && e.message ? e.message : "Error inesperado.");

/** Cuerpo binario del asistente de importación (.opios, SQLite o JSON), en octet-stream. */
async function cuerpoBytes(req) {
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/octet-stream"))
        throw new ErrorApi(415, "Envía el archivo como application/octet-stream.");
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_SUBIDA)
        throw new ErrorApi(413, `Archivo demasiado grande (máximo ${Math.round(MAX_SUBIDA / 1e6)} MB).`);
    return new Uint8Array(buf);
}

/** Cuerpo JSON de una petición de escritura. Exigir application/json impide los envíos cruzados desde formularios de otras webs. */
async function cuerpoJson(req) {
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json"))
        throw new ErrorApi(415, "El cuerpo debe ser application/json.");
    /* Se mide en bytes, no en caracteres: un texto con tildes ocupa más de lo que dice `length` (Fase 2.9). */
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_CUERPO) throw new ErrorApi(413, "Cuerpo demasiado grande.");
    try {
        return JSON.parse(new TextDecoder().decode(buf));
    } catch {
        throw new ErrorApi(400, "JSON no válido.");
    }
}

/** Lista de respuestas de una sesión; vacía si no se envía (Fase 2.8). */
function listaRespuestas(v) {
    if (v == null) return [];
    if (!Array.isArray(v)) throw new ErrorApi(400, "«respuestas» debe ser una lista.");
    return v.length ? validarRespuestas(v) : [];
}

/** Lista de entradas de progreso de una sesión; vacía si no se envía (Fase 2.8). */
function listaProgreso(v) {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > 5000)
        throw new ErrorApi(400, "«progreso» debe ser una lista de hasta 5000 entradas.");
    return v.map(validarProgreso);
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

/** Rutas /api/*: recibe la petición ya autenticada y responde JSON (sin render ni archivos).
    Con `gestor` (modo biblioteca, OPIOS_CATALOGO) añade las rutas /api/bancos (F3.1):
    en modo directo fallan con 409 y mensaje claro. `dirPreguntas`/`dirEjemplo` son los
    directorios JSON que el servidor puede importar/actualizar; `alActivar` lo llama el
    servidor tras cambiar de banco activo para reabrir su repo. */
export function crearApi(
    repo,
    servicios,
    { gestor = null, dirPreguntas = null, dirEjemplo = null, alActivar = null } = {},
) {
    const { fechaHoy, estadisticas, temarioConProgreso, infoExamen } = servicios;

    /* Biblioteca: los errores del gestor son de datos del usuario (nombre repetido, ruta
       ausente, banco activo…), siempre con mensaje claro → 400; lo del enrutado es ErrorApi. */
    async function bancos(req, m, ruta, url) {
        if (ruta === "/api/bancos" && m === "GET") {
            const lista = await gestor.listar();
            /* Resumen de progreso: solo el banco activo está abierto; el resto llega con F5.
               Se lee de la conexión que tiene el gestor (no de `repo`, que puede quedar
               cerrado tras un cambio de banco en caliente). */
            const activa = lista.find((b) => b.activo);
            /* Si el archivo del activo no está (F3.8) no hay conexión que consulte. */
            if (activa && activa.disponible)
                activa.progreso = (await gestor.abrirActivo()).estadisticasGlobales(fechaHoy(), CAJA_DOMINADA);
            return json(lista);
        }

        if (ruta === "/api/bancos/importar" && m === "POST") {
            const cuerpo = await cuerpoJson(req);
            const nombre = String(cuerpo?.nombre ?? "").trim();
            if (!nombre) throw new ErrorApi(400, "Indica el nombre del banco.");
            if (cuerpo.ruta != null && typeof cuerpo.ruta !== "string")
                throw new ErrorApi(400, "«ruta» debe ser un texto.");
            const dir = cuerpo.ejemplo ? dirEjemplo : cuerpo.ruta?.trim() || dirPreguntas;
            if (!dir) throw new ErrorApi(400, "Indica la ruta del directorio de preguntas.");
            return json(await gestor.importarJson(nombre, dir), 201);
        }

        /* "Usar donde está" (F4.1): registra una SQLite que ya existe en el disco del PC;
            el archivo sigue en su sitio (el progreso se guarda dentro). */
        if (ruta === "/api/bancos/registrar" && m === "POST") {
            const cuerpo = await cuerpoJson(req);
            const nombre = String(cuerpo?.nombre ?? "").trim();
            const archivo = String(cuerpo?.ruta ?? "").trim();
            if (!nombre) throw new ErrorApi(400, "Indica el nombre del banco.");
            if (!archivo) throw new ErrorApi(400, "Indica la ruta del archivo del banco.");
            return json(await gestor.registrar(nombre, archivo), 201);
        }

        /* Asistente de importación (F3.4/F3.5): el archivo viaja en el cuerpo. */
        if (ruta === "/api/bancos/inspeccionar" && m === "POST") {
            const bytes = await cuerpoBytes(req);
            return json(await gestor.inspeccionar(bytes, { nombre: url.searchParams.get("nombre") ?? "" }));
        }
        if (ruta === "/api/bancos/importar-archivo" && m === "POST") {
            const bytes = await cuerpoBytes(req);
            const modo = url.searchParams.get("modo") === "actualizar" ? "actualizar" : "nuevo";
            const id = modo === "actualizar" ? entero(url.searchParams.get("id"), { min: 1 }) : null;
            if (Number.isNaN(id)) throw new ErrorApi(400, "Falta el id del banco a actualizar (?id=).");
            return json(
                await gestor.importarBytes(bytes, {
                    nombre: url.searchParams.get("nombre") ?? "",
                    modo,
                    id,
                }),
                201,
            );
        }

        const mb = ruta.match(/^\/api\/bancos\/(\d+)(?:\/(activar|exportar|actualizar|desvincular|localizar))?$/);
        if (mb) {
            const id = Number(mb[1]);
            if (mb[2] === "activar" && m === "POST") {
                await gestor.activar(id);
                const nuevo = await gestor.abrirActivo();
                if (alActivar) await alActivar(nuevo);
                return json({ ok: true, activo: id });
            }
            if (mb[2] === "exportar" && m === "POST") {
                const incluyeProgreso = url.searchParams.get("progreso") !== "0";
                const { bytes, manifest } = await gestor.exportar(id, { incluyeProgreso });
                const archivo =
                    String(manifest.nombre)
                        .replace(/[^a-zA-Z0-9._-]+/g, "-")
                        .replace(/^-+|-+$/g, "") || "banco";
                return new Response(bytes, {
                    headers: {
                        "Content-Type": "application/octet-stream",
                        "Content-Disposition": `attachment; filename="${archivo}${incluyeProgreso ? "" : "-sin-progreso"}.opios"`,
                        "Cache-Control": "no-store",
                    },
                });
            }
            if (mb[2] === "actualizar" && m === "POST") {
                if (!dirPreguntas)
                    throw new ErrorApi(400, "No hay directorio de preguntas configurado (OPIOS_PREGUNTAS).");
                return json(await gestor.actualizar(id, dirPreguntas));
            }
            if (mb[2] === "desvincular" && m === "POST") {
                await gestor.desvincular(id);
                return new Response(null, { status: 204 });
            }
            if (mb[2] === "localizar" && m === "POST") {
                const cuerpo = await cuerpoJson(req);
                const r = await gestor.localizar(id, String(cuerpo?.ruta ?? ""));
                /* Si relocalizamos el activo, el repo del servidor (caliente) apunta al archivo nuevo. */
                if (r.activo) {
                    const nuevo = await gestor.abrirActivo();
                    if (alActivar) await alActivar(nuevo);
                }
                return json(r);
            }
            if (!mb[2]) {
                if (m === "PUT") {
                    const cuerpo = await cuerpoJson(req);
                    return json(await gestor.renombrar(id, String(cuerpo?.nombre ?? "")));
                }
                if (m === "DELETE") {
                    await gestor.borrar(id);
                    return new Response(null, { status: 204 });
                }
            }
        }

        throw new ErrorApi(404, "Ruta no encontrada.");
    }

    return async function api(req, url, ruta) {
        const m = req.method;

        if (ruta.startsWith("/api/bancos")) {
            if (!gestor)
                throw new ErrorApi(
                    409,
                    "La biblioteca no está disponible: la app está en modo directo (OPIOS_DB). Arranca con OPIOS_CATALOGO.",
                );
            try {
                const r = await bancos(req, m, ruta, url);
                /* Catálogo vivo también en Android (F4.4): sql.js solo escribe al volcar. */
                if (m !== "GET") await gestor.persistir();
                return r;
            } catch (e) {
                if (e instanceof ErrorApi) throw e;
                throw new ErrorApi(400, msgErrorDe(e));
            }
        }

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

        /* Respuestas y progreso de una sesión en una sola transacción (Fase 2.8). Los contadores
           de `progreso` son incrementos (+aciertos, +fallos), así dos pestañas suman en vez de pisarse. */
        if (ruta === "/api/sesion" && m === "POST") {
            const cuerpo = await cuerpoJson(req);
            if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo))
                throw new ErrorApi(400, "Se esperaba un objeto con respuestas y progreso.");
            const respuestas = listaRespuestas(cuerpo.respuestas);
            const progreso = listaProgreso(cuerpo.progreso);
            return json(repo.aplicarSesion(respuestas, progreso, fechaHoy()), 201);
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
    };
}
