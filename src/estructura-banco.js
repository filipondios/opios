/* Estructura física del banco de preguntas (Fase 2.5): un solo sitio donde vive la regla.
   La app es una lista de permitidos: solo se leen las carpetas `bloque_N/` y, dentro,
   `info.json` y `tema_N.json`. Cualquier otro archivo o carpeta (`generated/`, `examenes/`,
   notas, PDF…) se ignora sin configurar nada. `seed`, `validar`, `calidad` e `ids` recorren
   el banco con este módulo, así que todos aplican la misma regla. */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

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
const clave = (n) =>
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
 * Recorre un directorio de banco y clasifica todo lo que hay. Es puro respecto al orden:
 * los nombres entran ya listados, así que se puede probar sin tocar el disco.
 * @returns {{bloques: Array<{nombre:string, numero:number, ruta:string}>, sueltos: string[], ignorados: Array<{nombre:string, motivo:string}>, avisos: string[]}}
 */
export function clasificarBanco(dir, nombres) {
    const bloques = [],
        sueltos = [],
        ignorados = [],
        avisos = [];
    for (const nombre of [...nombres].sort()) {
        if (RE_BLOQUE.test(nombre)) {
            bloques.push({ nombre, numero: numeroDe(RE_BLOQUE, nombre), ruta: join(dir, nombre) });
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
export function clasificarBloque(dir, bloque, nombres) {
    const temas = [],
        otros = [],
        avisos = [];
    let info = null;
    for (const nombre of [...nombres].sort()) {
        if (esInfo(nombre)) {
            info = { nombre, ruta: join(dir, bloque, nombre) };
            continue;
        }
        if (RE_TEMA.test(nombre)) {
            temas.push({
                nombre,
                numero: numeroDe(RE_TEMA, nombre),
                ruta: join(dir, bloque, nombre),
            });
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
 * Recorrido único del banco: lee el directorio y cada `bloque_N/` y devuelve lo importable
 * junto con lo ignorado y los avisos de nombres parecidos. Con `soloBloques` no se consideran
 * los JSON sueltos de la raíz (el exportador nunca los escribe: usa `bloque_N.json`).
 * `leer` se puede inyectar para probarlo sin sistema de archivos.
 */
export async function recorrerBanco(dir, { leer = readdir, soloBloques = false } = {}) {
    const resultado = { dir, bloques: [], sueltos: [], ignorados: [], avisos: [] };
    let raiz;
    try {
        raiz = await leer(dir);
    } catch {
        return null; // el directorio no existe: quien llame decidirá qué hacer
    }

    const r = clasificarBanco(dir, raiz);
    resultado.sueltos = soloBloques ? [] : r.sueltos.map((n) => join(dir, n));
    if (soloBloques) for (const n of r.sueltos) resultado.ignorados.push({ ruta: n, motivo: "JSON suelto en la raíz" });
    resultado.avisos.push(...r.avisos);
    for (const i of r.ignorados) resultado.ignorados.push({ ruta: i.nombre, motivo: i.motivo });

    for (const bloque of r.bloques) {
        let dentro;
        try {
            dentro = await leer(bloque.ruta);
        } catch (e) {
            resultado.avisos.push(`${bloque.nombre}: no se puede leer su contenido (${e.message}).`);
            continue;
        }
        const c = clasificarBloque(dir, bloque.nombre, dentro);
        resultado.avisos.push(...c.avisos);
        for (const o of c.otros) resultado.ignorados.push({ ruta: `${bloque.nombre}/${o.nombre}`, motivo: o.motivo });
        resultado.bloques.push({ ...bloque, info: c.info, temas: c.temas });
    }
    return resultado;
}

/** Lista plana de archivos de tema del banco, con su bloque. `incluye` añade otras carpetas (p. ej. `--incluir generated`). */
export async function archivosDeBanco(dir, { incluye = [], leer = readdir, soloBloques = false } = {}) {
    const banco = await recorrerBanco(dir, { leer, soloBloques });
    if (!banco) return { banco: null, archivos: [] };
    const extra = new Set(incluye.map((n) => clave(n)));
    const archivos = [];
    for (const b of banco.bloques) {
        for (const t of b.temas) archivos.push({ ruta: t.ruta, bloque: b.nombre, tema: t.numero, generado: false });
        let dentro;
        try {
            dentro = await leer(b.ruta);
        } catch {
            continue;
        }
        for (const nombre of dentro.sort()) {
            if (!extra.has(clave(nombre))) continue;
            let hijos;
            try {
                hijos = await leer(join(b.ruta, nombre));
            } catch {
                continue;
            }
            for (const h of hijos.filter((x) => /\.json$/i.test(x)).sort())
                archivos.push({
                    ruta: join(b.ruta, nombre, h),
                    bloque: b.nombre,
                    tema: RE_TEMA.test(h) ? numeroDe(RE_TEMA, h) : null,
                    generado: true,
                });
        }
    }
    /* Formato antiguo: JSON sueltos en la raíz (sin contar los que escribe `export --por-bloques`). */
    for (const ruta of banco.sueltos)
        if (!RE_EXPORTE.test(ruta.slice(dir.length + 1)))
            archivos.push({ ruta, bloque: null, tema: null, generado: false });
    return { banco, archivos };
}
