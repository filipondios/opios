/* Versión PC del lector de estructura (F2.6): `archivosDeBanco` sobre un directorio real,
   con rutas del sistema de archivos para los CLI (`ids`, `calidad`). El núcleo neutro vive
   en estructura-banco.js; esto solo añade node:fs/node:path. */
import { join } from "node:path";
import { RE_TEMA, RE_EXPORTE, clave, recorrerBanco } from "./estructura-banco.js";
import { fuenteDirectorio } from "./fuente-directorio.js";

const numeroDe = (re, nombre) => Number(re.exec(nombre)[1]);

/** Lista plana de archivos de banco (con ruta real de disco) y su bloque. `incluye` añade
    otras carpetas del bloque (p. ej. `--incluir generated`). */
export async function archivosDeBanco(dir, { incluye = [], soloBloques = false } = {}) {
    const fuente = fuenteDirectorio(dir);
    const banco = await recorrerBanco(fuente, { soloBloques });
    if (!banco) return { banco: null, archivos: [] };
    const extra = new Set(incluye.map((n) => clave(n)));
    const archivos = [];
    for (const b of banco.bloques) {
        for (const t of b.temas)
            archivos.push({ ruta: join(dir, t.ruta), bloque: b.nombre, tema: t.numero, generado: false });
        for (const nombre of (await fuente.listar(b.ruta)).sort()) {
            if (!extra.has(clave(nombre))) continue;
            let hijos;
            try {
                hijos = await fuente.listar(`${b.ruta}/${nombre}`);
            } catch {
                continue;
            }
            for (const h of hijos.filter((x) => /\.json$/i.test(x)).sort())
                archivos.push({
                    ruta: join(dir, b.ruta, nombre, h),
                    bloque: b.nombre,
                    tema: RE_TEMA.test(h) ? numeroDe(RE_TEMA, h) : null,
                    generado: true,
                });
        }
    }
    /* Formato antiguo: JSON sueltos en la raíz (sin contar los que escribe `export --por-bloques`). */
    for (const ruta of banco.sueltos)
        if (!RE_EXPORTE.test(ruta)) archivos.push({ ruta: join(dir, ruta), bloque: null, tema: null, generado: false });
    return { banco, archivos };
}
