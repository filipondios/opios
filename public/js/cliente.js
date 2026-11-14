/* Interfaz de datos que consume la UI (task 10 del TODO): operaciones con nombre, sin URLs
   ni fetch. La implementación actual es el cliente HTTP para PC, sobre `api()` de comun.js.
   Para Android se sustituye este archivo por otro con las mismas funciones sobre servicios
   locales; ningún módulo de UI debe llamar a `api()` ni `fetch()` por su cuenta
   (test/contratos-ui.test.js lo comprueba). */

import { api } from "./comun.js";

/* --- Test (portada) --- */
export const temario = () => api("/api/temario");
export const test = (temas) => api("/api/test?temas=" + [...temas].sort((a, b) => a - b).join(","));
export const carga = () => api("/api/carga");
export const sesionGuardar = (cuerpo) => api("/api/sesion", { metodo: "POST", keepalive: true, cuerpo });
export const progresoReiniciar = () => api("/api/progreso", { metodo: "DELETE" });
export const ajustesGuardar = (fechaExamen) =>
    api("/api/ajustes", { metodo: "PUT", cuerpo: { fecha_examen: fechaExamen || null } });

/* Fragmento SSR con la rejilla de temas. shortcut: acopla la UI al SSR del servidor; en
   Android hay que sustituirlo por el render local de la rejilla (o un adaptador que genere HTML). */
export const fragmentosTemas = () => api("/fragmentos/temas", { bruto: true }).then((r) => r.text());

/* --- Simulacro --- */
export const simulacroGuardar = (cuerpo) => api("/api/simulacros", { metodo: "POST", cuerpo });

/* --- Maker (preguntas) --- */
export const preguntaObtener = (id) => api("/api/preguntas/" + id);
export const preguntaGuardar = (cuerpo, id = null) =>
    id === null ? api("/api/preguntas", { metodo: "POST", cuerpo }) : api("/api/preguntas/" + id, { metodo: "PUT", cuerpo });
export const preguntaBorrar = (id) => api("/api/preguntas/" + id, { metodo: "DELETE" });
export const preguntasListar = (consulta) => api("/api/preguntas?" + consulta);

/* --- Temario (bloques y temas) --- */
export const bloquesReordenar = (ids) => api("/api/bloques/reordenar", { metodo: "POST", cuerpo: { ids } });
export const bloqueGuardar = (nombre, id = null) =>
    id === null ? api("/api/bloques", { metodo: "POST", cuerpo: { nombre } }) : api("/api/bloques/" + id, { metodo: "PUT", cuerpo: { nombre } });
export const bloqueBorrar = (id) => api("/api/bloques/" + id, { metodo: "DELETE" });
export const temaGuardar = ({ bloque, numero, nombre }, id = null) => {
    const cuerpo = { bloque, numero, nombre };
    return id === null
        ? api("/api/temas", { metodo: "POST", cuerpo })
        : api("/api/temas/" + id, { metodo: "PUT", cuerpo });
};
export const temaBorrar = (id) => api("/api/temas/" + id, { metodo: "DELETE" });
