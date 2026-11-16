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
    id === null
        ? api("/api/preguntas", { metodo: "POST", cuerpo })
        : api("/api/preguntas/" + id, { metodo: "PUT", cuerpo });
export const preguntaBorrar = (id) => api("/api/preguntas/" + id, { metodo: "DELETE" });
export const preguntasListar = (consulta) => api("/api/preguntas?" + consulta);

/* --- Temario (bloques y temas) --- */
export const bloquesReordenar = (ids) => api("/api/bloques/reordenar", { metodo: "POST", cuerpo: { ids } });
export const bloqueGuardar = (nombre, id = null) =>
    id === null
        ? api("/api/bloques", { metodo: "POST", cuerpo: { nombre } })
        : api("/api/bloques/" + id, { metodo: "PUT", cuerpo: { nombre } });
export const bloqueBorrar = (id) => api("/api/bloques/" + id, { metodo: "DELETE" });
export const temaGuardar = ({ bloque, numero, nombre }, id = null) => {
    const cuerpo = { bloque, numero, nombre };
    return id === null
        ? api("/api/temas", { metodo: "POST", cuerpo })
        : api("/api/temas/" + id, { metodo: "PUT", cuerpo });
};
export const temaBorrar = (id) => api("/api/temas/" + id, { metodo: "DELETE" });

/* --- Biblioteca (bancos, F3.1) --- */
export const bancosListar = () => api("/api/bancos");
export const bancoImportar = (cuerpo) => api("/api/bancos/importar", { metodo: "POST", cuerpo });
export const bancoActivar = (id) => api(`/api/bancos/${id}/activar`, { metodo: "POST", cuerpo: {} });
export const bancoActualizar = (id) => api(`/api/bancos/${id}/actualizar`, { metodo: "POST", cuerpo: {} });
/* Deshacer última actualización/restauración/migración (5.9). */
export const bancoDeshacer = (id) => api(`/api/bancos/${id}/deshacer`, { metodo: "POST", cuerpo: {} });
/* Devuelve la Response cruda: el exportar es una descarga, no JSON. `conProgreso:false`
   (F5.5) empaqueta el banco sin progreso. */
export const bancoExportar = (id, { conProgreso = true } = {}) =>
    api(`/api/bancos/${id}/exportar${conProgreso ? "" : "?progreso=0"}`, { metodo: "POST", bruto: true });
/* Copia completa (F5.6): descarga un `.opios-backup` con todos los bancos (Response cruda). */
export const bancoCopia = () => api("/api/bancos/copia", { metodo: "POST", bruto: true });
export const copiaInspeccionar = (bytes) => api("/api/bancos/copia/inspeccionar", { metodo: "POST", cuerpo: bytes });
export const copiaRestaurar = (bytes, { archivos = [], sobrescribir = false } = {}) => {
    const p = new URLSearchParams();
    if (archivos.length) p.set("archivos", archivos.join(","));
    if (sobrescribir) p.set("sobrescribir", "1");
    return api(`/api/bancos/copia/restaurar${p.toString() ? `?${p}` : ""}`, { metodo: "POST", cuerpo: bytes });
};
export const bancoRenombrar = (id, nombre) => api(`/api/bancos/${id}`, { metodo: "PUT", cuerpo: { nombre } });
export const bancoBorrar = (id) => api(`/api/bancos/${id}`, { metodo: "DELETE" });
/* "Usar donde está" (F4.1): registra un archivo .db que ya existe en el disco del PC. */
export const bancoRegistrar = (nombre, ruta) =>
    api("/api/bancos/registrar", { metodo: "POST", cuerpo: { nombre, ruta } });
/* Desvincular (F3.7): quita el banco del catálogo sin tocar su archivo (bancos registrados en PC). */
export const bancoDesvincular = (id) => api(`/api/bancos/${id}/desvincular`, { metodo: "POST", cuerpo: {} });
/* Localizar (F3.8): reenlaza un banco cuyo archivo se movió o desconectó. */
export const bancoLocalizar = (id, ruta) => api(`/api/bancos/${id}/localizar`, { metodo: "POST", cuerpo: { ruta } });
/* Asistente de importación (F3.4): el archivo viaja como bytes. `nombre` (nombre del
   archivo elegido) ayuda a sugerir nombre y detectar duplicados por nombre. */
export const bancoInspeccionar = (bytes, nombre = "") =>
    api("/api/bancos/inspeccionar" + (nombre ? `?nombre=${encodeURIComponent(nombre)}` : ""), {
        metodo: "POST",
        cuerpo: bytes,
    });
export const bancoImportarArchivo = (bytes, { nombre = "", modo = "nuevo", id = null } = {}) => {
    const p = new URLSearchParams({ modo });
    if (nombre) p.set("nombre", nombre);
    if (id != null) p.set("id", String(id));
    return api(`/api/bancos/importar-archivo?${p}`, { metodo: "POST", cuerpo: bytes });
};
