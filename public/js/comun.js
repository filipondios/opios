/* Utilidades comunes del cliente. Módulo ESM sin estado ni dependencias del DOM
   más allá de `h`, que crea elementos. No importar desde `src`: la capa servidor
   no debe depender del cliente. */

export const LETRAS = "ABCDEFGH";
export const MIN_OPC = 2;
export const MAX_OPC = 8;

export const msgError = (e) => (e && e.message ? e.message : String(e));

/** Clave de localStorage dependiente del banco activo (F1.5): `opios.<idBanco>.<nombre>`.
    El id lo inyecta el servidor/puente en `globalThis.__opiosBancoId`; sin él queda `opios.<nombre>`. */
export const claveBanco = (nombre) =>
    globalThis.__opiosBancoId ? `opios.${globalThis.__opiosBancoId}.${nombre}` : `opios.${nombre}`;

/** ¿Hay un simulacro a mitad? (F2.8) La biblioteca lo consultará antes de cambiar de banco:
    si lo hay, pedirá confirmación antes del flush -> cerrar -> abrir. */
export const simulacroEnCurso = () => {
    try {
        return localStorage.getItem(claveBanco("simulacro.curso")) != null;
    } catch {
        return false;
    }
};

/** Error HTTP con el status y el cuerpo que devolvió el servidor. */
export class ErrorHttp extends Error {
    constructor(status, datos = {}) {
        super(datos.error || "El servidor respondió " + status + ".");
        this.name = "ErrorHttp";
        this.status = status;
        this.datos = datos;
    }
}

/** Crea un elemento. Acepta `class`, `text`, booleanos (`open`, `checked`, `disabled`) y eventos `on*`. */
export function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props)
        for (const [k, v] of Object.entries(props)) {
            if (v == null || v === false) continue;
            if (k === "class") e.className = v;
            else if (k === "text") e.textContent = v;
            else if (k === "open") e.open = !!v;
            else if (k === "checked") e.checked = !!v;
            else if (k === "disabled") e.disabled = !!v;
            else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
            else e.setAttribute(k, v);
        }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
    return e;
}

/** Baraja una copia de la lista. `azar` se inyecta para poder probarlo. */
export function barajar(lista, azar = Math.random) {
    const a = lista.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function leerError(r) {
    try {
        const datos = await r.json();
        return datos && typeof datos === "object" ? datos : {};
    } catch {
        return {};
    }
}

/**
 * Petición a la API.
 * - Por defecto devuelve el JSON (o `null` con 204) y lanza `ErrorHttp` si falla.
 * - Con `bruto: true` devuelve la `Response` (para HTML u otros formatos).
 * - `cuerpo` se serializa como JSON; el resto de opciones de fetch se pasan tal cual.
 */
export async function api(url, { metodo = "GET", cuerpo, bruto = false, headers, ...init } = {}) {
    const opciones = { method: metodo, ...init };
    if (cuerpo instanceof Uint8Array) {
        /* Archivo del asistente de importación (F3.4): bytes crudos, no JSON. */
        opciones.headers = { ...(headers || {}), "Content-Type": "application/octet-stream" };
        opciones.body = cuerpo;
    } else if (cuerpo !== undefined) {
        opciones.headers = { ...(headers || {}), "Content-Type": "application/json" };
        opciones.body = JSON.stringify(cuerpo);
    } else if (headers) {
        opciones.headers = headers;
    }

    const r = await fetch(url, opciones);
    if (bruto) {
        if (!r.ok) throw new ErrorHttp(r.status, await leerError(r));
        return r;
    }
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
