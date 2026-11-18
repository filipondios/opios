/* Interfaz de datos (task 10): operaciones con nombre sin red ni DOM. El shell lo envía
   al núcleo vía window.__opios. */

import { ErrorHttp, senalOperacion } from "./comun.js";

async function llamada(ruta, { metodo = "GET", cuerpo, bruto = false } = {}) {
    const opciones = { method: metodo };
    const senal = senalOperacion();
    if (senal) opciones.signal = senal;
    if (cuerpo instanceof Uint8Array) {
        /* Archivo del asistente de importación (F3.4): bytes crudos, no JSON. */
        opciones.headers = { "Content-Type": "application/octet-stream" };
        opciones.body = cuerpo;
    } else if (cuerpo !== undefined) {
        opciones.headers = { "Content-Type": "application/json" };
        opciones.body = JSON.stringify(cuerpo);
    }
    const r = await globalThis.__opios(new Request("http://opios.local" + ruta, opciones));
    if (bruto) return r;
    if (r.status === 204) return null;
    let datos = {};
    try {
        datos = await r.json();
    } catch {
        /* respuesta sin cuerpo o no JSON */
    }
    if (!r.ok) throw new ErrorHttp(r.status, datos);
    return datos;
}

/* --- Test (portada) --- */
export const temario = () => llamada("/api/temario");
export const test = (temas) => llamada("/api/test?temas=" + [...temas].sort((a, b) => a - b).join(","));
export const carga = () => llamada("/api/carga");
export const sesionGuardar = (cuerpo) => llamada("/api/sesion", { metodo: "POST", cuerpo });
export const progresoReiniciar = () => llamada("/api/progreso", { metodo: "DELETE" });
export const ajustesGuardar = (fechaExamen) =>
    llamada("/api/ajustes", { metodo: "PUT", cuerpo: { fecha_examen: fechaExamen || null } });

/* El shell ya pintó la página; el fragmento SSR va por el mismo núcleo local. */
export const fragmentosTemas = () => llamada("/fragmentos/temas", { bruto: true }).then((r) => r.text());

/* --- Simulacro --- */
export const simulacroGuardar = (cuerpo) => llamada("/api/simulacros", { metodo: "POST", cuerpo });

/* --- Maker (preguntas) --- */
export const preguntaObtener = (id) => llamada("/api/preguntas/" + id);
export const preguntaGuardar = (cuerpo, id = null) =>
    id === null
        ? llamada("/api/preguntas", { metodo: "POST", cuerpo })
        : llamada("/api/preguntas/" + id, { metodo: "PUT", cuerpo });
export const preguntaBorrar = (id) => llamada("/api/preguntas/" + id, { metodo: "DELETE" });
export const preguntasListar = (consulta) => llamada("/api/preguntas?" + consulta);

/* --- Temario (bloques y temas) --- */
export const bloquesReordenar = (ids) => llamada("/api/bloques/reordenar", { metodo: "POST", cuerpo: { ids } });
export const bloqueGuardar = (nombre, id = null) =>
    id === null
        ? llamada("/api/bloques", { metodo: "POST", cuerpo: { nombre } })
        : llamada("/api/bloques/" + id, { metodo: "PUT", cuerpo: { nombre } });
export const bloqueBorrar = (id) => llamada("/api/bloques/" + id, { metodo: "DELETE" });
export const temaGuardar = ({ bloque, numero, nombre }, id = null) => {
    const cuerpo = { bloque, numero, nombre };
    return id === null
        ? llamada("/api/temas", { metodo: "POST", cuerpo })
        : llamada("/api/temas/" + id, { metodo: "PUT", cuerpo });
};
export const temaBorrar = (id) => llamada("/api/temas/" + id, { metodo: "DELETE" });

/* --- Biblioteca (bancos, F3.1) --- */
export const bancosListar = () => llamada("/api/bancos");
export const bancoImportar = (cuerpo) => llamada("/api/bancos/importar", { metodo: "POST", cuerpo });
export const bancoActivar = (id) => llamada(`/api/bancos/${id}/activar`, { metodo: "POST", cuerpo: {} });
export const bancoActualizar = (id) => llamada(`/api/bancos/${id}/actualizar`, { metodo: "POST", cuerpo: {} });
/* Deshacer última actualización/restauración/migración (5.9). */
export const bancoDeshacer = (id) => llamada(`/api/bancos/${id}/deshacer`, { metodo: "POST", cuerpo: {} });
/* Devuelve la Response cruda: el exportar es una descarga, no JSON. `conProgreso:false`
   (F5.5) empaqueta el banco sin progreso. */
export const bancoExportar = (id, { conProgreso = true } = {}) =>
    llamada(`/api/bancos/${id}/exportar${conProgreso ? "" : "?progreso=0"}`, { metodo: "POST", bruto: true });
/* Copia completa (F5.6): descarga un `.opios-backup` con todos los bancos (Response cruda). */
export const bancoCopia = () => llamada("/api/bancos/copia", { metodo: "POST", bruto: true });
export const copiaInspeccionar = (bytes) =>
    llamada("/api/bancos/copia/inspeccionar", { metodo: "POST", cuerpo: bytes });
export const copiaRestaurar = (bytes, { archivos = [], sobrescribir = false } = {}) => {
    const p = new URLSearchParams();
    if (archivos.length) p.set("archivos", archivos.join(","));
    if (sobrescribir) p.set("sobrescribir", "1");
    return llamada(`/api/bancos/copia/restaurar${p.toString() ? `?${p}` : ""}`, { metodo: "POST", cuerpo: bytes });
};
export const bancoRenombrar = (id, nombre) => llamada(`/api/bancos/${id}`, { metodo: "PUT", cuerpo: { nombre } });
export const bancoBorrar = (id) => llamada(`/api/bancos/${id}`, { metodo: "DELETE" });
/* "Usar donde está" (F4.1): registra un archivo .db que ya existe en el disco del PC. */
export const bancoRegistrar = (nombre, ruta) =>
    llamada("/api/bancos/registrar", { metodo: "POST", cuerpo: { nombre, ruta } });
/* Desvincular (F3.7): quita el banco del catálogo sin tocar su archivo (bancos registrados en PC). */
export const bancoDesvincular = (id) => llamada(`/api/bancos/${id}/desvincular`, { metodo: "POST", cuerpo: {} });
/* Localizar (F3.8): reenlaza un banco cuyo archivo se movió o desconectó. */
export const bancoLocalizar = (id, ruta) =>
    llamada(`/api/bancos/${id}/localizar`, { metodo: "POST", cuerpo: { ruta } });
/* Asistente de importación (F3.4): el archivo viaja como bytes. `nombre` (nombre del
   archivo elegido) ayuda a sugerir nombre y detectar duplicados por nombre. */
export const bancoInspeccionar = (bytes, nombre = "") =>
    llamada("/api/bancos/inspeccionar" + (nombre ? `?nombre=${encodeURIComponent(nombre)}` : ""), {
        metodo: "POST",
        cuerpo: bytes,
    });
export const bancoImportarArchivo = (bytes, { nombre = "", modo = "nuevo", id = null } = {}) => {
    const p = new URLSearchParams({ modo });
    if (nombre) p.set("nombre", nombre);
    if (id != null) p.set("id", String(id));
    return llamada(`/api/bancos/importar-archivo?${p}`, { metodo: "POST", cuerpo: bytes });
};
