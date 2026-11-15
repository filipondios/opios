/* Estructura física del banco de preguntas (Fase 2.5, neutra desde F2.6): un solo sitio
   donde vive la regla. La app es una lista de permitidos: solo se leen las carpetas
   `bloque_N/` y, dentro, `info.json` y `tema_N.json`. Cualquier otro archivo o carpeta
   (`generated/`, `examenes/`, notas, PDF…) se ignora sin configurar nada. `seed`, `validar`,
   `calidad` e `ids` recorren el banco con este módulo, así que todos aplican la misma regla.
   Las rutas que devuelve son RELATIVAS a la raíz de la `fuente` (fuente.js), nunca del
   sistema de archivos; la versión PC (archivosDeBanco) está en estructura-banco-directorio.js. */

import { comprobarFuente } from "./fuente.js";

/** Carpeta de bloque: minúsculas, guion bajo y número sin ceros a la izquierda (`bloque_1`). */
export const RE_BLOQUE = /^bloque_([1-9]\d*)$/;
/** Archivo de tema: `tema_N.json`, con la extensión en minúsculas y sin ceros a la izquierda (`TEMA_1.JSON` no vale). */
export const RE_TEMA = /^tema_(0|[1-9]\d*)\.json$/;
/** Archivo de metadatos de un bloque. */
export const INFO = "info.json";
/** Nombre del JSON suelto que escribe `bun run export --por-bloques` fuera de las carpetas. */
export const RE_EXPORTE = /^bloque_\d+\.json$/i;
/** Un bloque mal escrito: mayúsculas, espacios o ceros a la izquierda (`Bloque_1`, `bloque_01`). */
const RE_BLOQUE_PARECIDO = /^(?:[^\W_]\w*[\s_-]*)?bloque[\s_-]*0*\d/i;
/** Un tema mal escrito por el mismo motivo. */
const RE_TEMA_PARECIDO = /^tema[\s_-]*0*\d+\./i;

const numeroDe = (re, nombre) => Number(re.exec(nombre)[1]);
/** Normaliza un nombre para compararlo sin mayúsculas, espacios ni guiones. */
export const clave = (n) =>
    String(n)
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
const esInfo = (n) => clave(n) === "info.json";

/** Pared entre lo que la regla permite y lo que solo se parece: si pasa lo primero, no avisa. */
export function parecidoABloque(nombre) {
    return !RE_BLOQUE.test(nombre) && RE_BLOQUE_PARECIDO.test(clave(nombre));
}
export function parecidoATema(nombre) {
    return !RE_TEMA.test(nombre) && RE_TEMA_PARECIDO.test(clave(nombre));
}

/**
 * Clasifica el contenido de la raíz del banco. Es puro respecto al orden: los nombres entran
 * ya listados, así que se puede probar sin sistema de archivos.
 * @returns {{bloques: Array<{nombre:string, numero:number, ruta:string}>, sueltos: string[], ignorados: Array<{nombre:string, motivo:string}>, avisos: string[]}}
 */
export function clasificarBanco(nombres) {
    const bloques = [],
        sueltos = [],
        ignorados = [],
        avisos = [];
    for (const nombre of [...nombres].sort()) {
        if (RE_BLOQUE.test(nombre)) {
            bloques.push({ nombre, numero: numeroDe(RE_BLOQUE, nombre), ruta: nombre });
            continue;
        }
        if (parecidoABloque(nombre)) {
            ignorados.push({ nombre, motivo: "carpeta parecida a un bloque" });
            avisos.push(
                `${nombre}: se ignora. Los bloques se llaman exactamente «bloque_N» (minúsculas, sin ceros a la izquierda).`,
            );
            continue;
        }
        if (RE_JSON_RAIZ.test(nombre)) {
            ignorados.push({ nombre, motivo: "JSON suelto en la raíz" });
            sueltos.push(nombre);
            continue;
        }
        ignorados.push({ nombre, motivo: "fuera de la regla de importación" });
    }
    bloques.sort((a, b) => a.numero - b.numero || (a.nombre < b.nombre ? -1 : 1));
    return { bloques, sueltos, ignorados, avisos };
}

const RE_JSON_RAIZ = /\.json$/i;

/** Clasifica el contenido de una carpeta de bloque. */
export function clasificarBloque(bloque, nombres) {
    const temas = [],
        otros = [],
        avisos = [];
    let info = null;
    for (const nombre of [...nombres].sort()) {
        if (esInfo(nombre)) {
            info = { nombre, ruta: `${bloque}/${nombre}` };
            continue;
        }
        if (RE_TEMA.test(nombre)) {
            temas.push({ nombre, numero: numeroDe(RE_TEMA, nombre), ruta: `${bloque}/${nombre}` });
            continue;
        }
        if (parecidoATema(nombre)) {
            otros.push({ nombre, motivo: "archivo parecido a un tema" });
            avisos.push(
                `${bloque}/${nombre}: se ignora. Los temas se llaman exactamente «tema_N.json» (minúsculas, sin ceros a la izquierda).`,
            );
            continue;
        }
        otros.push({ nombre, motivo: "fuera de la regla de importación" });
    }
    temas.sort((a, b) => a.numero - b.numero || (a.nombre < b.nombre ? -1 : 1));
    return { info, temas, otros, avisos };
}

/**
 * Recorrido único del banco a través de una `fuente` (F2.6): devuelve lo importable junto
 * con lo ignorado y los avisos de nombres parecidos. Las rutas del resultado son relativas
 * a la raíz de la fuente. Con `soloBloques` no se consideran los JSON sueltos de la raíz
 * (el exportador nunca los escribe: usa `bloque_N.json`). Devuelve null si la raíz no se
 * puede listar (no existe o es ilegible).
 */
export async function recorrerBanco(fuente, { soloBloques = false } = {}) {
    comprobarFuente(fuente);
    const resultado = { bloques: [], sueltos: [], ignorados: [], avisos: [] };
    let raiz;
    try {
        raiz = await fuente.listar();
    } catch {
        return null; // la raíz no está accesible: quien llame decidirá qué hacer
    }

    const r = clasificarBanco(raiz);
    resultado.sueltos = soloBloques ? [] : [...r.sueltos];
    if (soloBloques) for (const n of r.sueltos) resultado.ignorados.push({ ruta: n, motivo: "JSON suelto en la raíz" });
    resultado.avisos.push(...r.avisos);
    for (const i of r.ignorados) resultado.ignorados.push({ ruta: i.nombre, motivo: i.motivo });

    for (const bloque of r.bloques) {
        let dentro;
        try {
            dentro = await fuente.listar(bloque.ruta);
        } catch (e) {
            resultado.avisos.push(`${bloque.nombre}: no se puede leer su contenido (${e.message}).`);
            continue;
        }
        const c = clasificarBloque(bloque.nombre, dentro);
        resultado.avisos.push(...c.avisos);
        for (const o of c.otros) resultado.ignorados.push({ ruta: `${bloque.nombre}/${o.nombre}`, motivo: o.motivo });
        resultado.bloques.push({ ...bloque, info: c.info, temas: c.temas });
    }
    return resultado;
}
