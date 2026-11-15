/* Almacén de archivos neutro de plataforma (F2.1). Contrato (todo asíncrono, rutas relativas
   a su base): `existe(ruta)`, `leer(ruta) -> Uint8Array`, `escribir(ruta, bytes)`,
   `renombrar(de, a)`, `borrar(ruta)` (no falla si no existe), `listar(dir) -> nombres`.
   Implementaciones: `almacen-bun.js` (node:fs), `almacen-capacitor.js` (Filesystem,
   `Directory.Data`) y `almacen-memoria.js` (tests). */

export const METODOS_ALMACEN = ["existe", "leer", "escribir", "renombrar", "borrar", "listar"];

/** Lanza si `almacen` no implementa el contrato completo (lo usan los tests). */
export function comprobarAlmacen(almacen) {
    for (const m of METODOS_ALMACEN)
        if (typeof almacen?.[m] !== "function") throw new Error(`El almacén no implementa ${m}().`);
    return almacen;
}
