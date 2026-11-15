/* Driver SQLite neutro de plataforma (F2.2). Contrato:
   - `abrir(almacen, ruta, { readonly })` -> conexión con el contrato de `abrirRepo`
     (query/run/transaction/close). Bun abre por ruta; sql.js lee los bytes del almacén.
   - `instantanea(conexion)` -> Uint8Array con una copia consistente y compacta.
   - `userVersion(conexion)` -> versión del esquema.
   - `integridad(conexion)` -> `PRAGMA integrity_check` ("ok" si está bien).
   Implementaciones: `driver-bun.js` (bun:sqlite), `driver-wasm.js` (sql.js). */

export const METODOS_DRIVER = ["abrir", "instantanea", "userVersion", "integridad"];

/** Lanza si `driver` no implementa el contrato completo (lo usan los tests). */
export function comprobarDriver(driver) {
    for (const m of METODOS_DRIVER)
        if (typeof driver?.[m] !== "function") throw new Error(`El driver no implementa ${m}().`);
    return driver;
}

/** `PRAGMA user_version` de la conexión. */
export const userVersion = (db) => db.query("PRAGMA user_version").get().user_version;

/** `PRAGMA integrity_check`: "ok" cuando la base está íntegra. */
export const integridad = (db) => db.query("PRAGMA integrity_check").get().integrity_check;
