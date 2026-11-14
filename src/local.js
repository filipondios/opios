/* App local (task 11): el mismo núcleo de la app (servicios + API + páginas) montado sobre
   un repo cualquiera, SIN servidor ni `Bun.serve`. En Android el WebView llama aquí a
   través del puente; los archivos estáticos los sirve Capacitor, así que este manejador
   solo resuelve /api/* y las páginas SSR. Sin control de Host ni Basic auth: no hay red. */
import { crearServicios } from "./servicios.js";
import { crearApi } from "./api.js";
import { crearWeb } from "./web.js";
import { ErrorApi } from "./errores.js";

const json = (datos, status = 200) => Response.json(datos, { status });

export function crearAppLocal(repo) {
    const servicios = crearServicios(repo);
    const api = crearApi(repo, servicios);
    const web = crearWeb(repo, servicios);

    return async function manejar(req) {
        const url = new URL(req.url);
        const ruta = url.pathname;
        try {
            if (ruta.startsWith("/api/")) return await api(req, url, ruta);
            return (await web(ruta)) ?? json({ error: "Ruta no encontrada." }, 404);
        } catch (e) {
            if (e instanceof ErrorApi) return json({ error: e.message, ...e.extra }, e.status);
            console.error(new Date().toISOString(), e);
            return json({ error: "Error interno." }, 500);
        }
    };
}
