/* Driver SQLite sobre sql.js (F2.2): WebView de Android. No hay rutas: los bytes salen del
   almacén y la instantánea es `export()`. `readonly` es solo una comprobación: la copia vive
   en memoria y no se persiste, así que basta con no guardarla. */
import { abrirAdaptadorSqlite } from "./adaptador-sqlite-wasm.js";
import { integridad, userVersion } from "./driver.js";

export function crearDriverWasm({ rutaWasm = "sql-wasm.wasm" } = {}) {
    return {
        async abrir(almacen, ruta, { readonly = false } = {}) {
            const hay = await almacen.existe(ruta);
            if (!hay && readonly) throw new Error(`No existe el banco «${ruta}».`);
            return abrirAdaptadorSqlite({ bytes: hay ? await almacen.leer(ruta) : null, rutaWasm });
        },
        instantanea: (db) => db.exportar(),
        userVersion,
        integridad,
    };
}

export const driverWasm = crearDriverWasm();
