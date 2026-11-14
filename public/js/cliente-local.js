/* Interfaz de datos (task 10): operaciones con nombre sin red ni DOM. El shell lo envía
   al núcleo vía window.__opios. */

import { ErrorHttp } from "./comun.js";

async function llamada(ruta, { metodo = "GET", cuerpo, bruto = false } = {}) {
    const r = await globalThis.__opios(
        new Request("http://opios.local" + ruta, {
            method: metodo,
            headers: cuerpo !== undefined ? { "Content-Type": "application/json" } : undefined,
            body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        }),
    );
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
