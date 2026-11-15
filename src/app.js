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
 * `zona` (por defecto, la del sistema) decide en qué zona horaria se calcula ese «hoy»;
 * la inyecta el servidor (`APP_TZ`).
 */
export function crearApp(
    repo,
    {
        auth = null,
        ahora = () => new Date(),
        zona = null,
        banco = null,
        bancoNombre = null,
        gestor = null,
        dirPreguntas = null,
        dirEjemplo = null,
        alActivar = null,
    } = {},
) {
    const servicios = crearServicios(repo, { ahora, zona });
    return crearManejadorHttp({
        api: crearApi(repo, servicios, { gestor, dirPreguntas, dirEjemplo, alActivar }),
        web: crearWeb(repo, servicios, { banco, bancoNombre }),
        auth,
    });
}
