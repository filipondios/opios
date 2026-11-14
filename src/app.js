/* Punto de entrada de la app: compone las capas. La lógica vive en
   `src/servicios.js` (dominio), `src/api.js` (rutas /api), `src/web.js` (páginas SSR)
   y `src/http.js` (adaptador HTTP de Bun: estáticos, gzip, auth, cabeceras). */
import { crearServicios } from "./servicios.js";
import { crearApi } from "./api.js";
import { crearWeb } from "./web.js";
import { crearManejadorHttp } from "./http.js";

/**
 * Crea el manejador de peticiones (independiente del puerto, así se puede probar sin red).
 * Con `auth = { usuario, clave }` se exige autenticación HTTP Basic en todo salvo /healthz.
 * `ahora` devuelve la fecha actual; los tests la fijan para calcular repasos «de hoy».
 * `zona` (por defecto `APP_TZ`) decide en qué zona horaria se calcula ese «hoy».
 */
export function crearApp(repo, { auth = null, ahora = () => new Date(), zona } = {}) {
    const servicios = crearServicios(repo, { ahora, zona });
    return crearManejadorHttp({
        api: crearApi(repo, servicios),
        web: crearWeb(repo, servicios),
        auth,
    });
}
