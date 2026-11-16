/* Driver SQLite sobre sql.js (F2.2): WebView de Android. No hay rutas: los bytes salen del
   almacén y la instantánea es `export()`. `readonly` es solo una comprobación: la copia vive
   en memoria y no se persiste, así que basta con no guardarla. */
import { abrirAdaptadorSqlite } from "./adaptador-sqlite-wasm.js";
import { integridad, userVersion } from "./driver.js";

export function crearDriverWasm({ rutaWasm = "sql-wasm.wasm", onCambios = () => {} } = {}) {
    return {
        async abrir(almacen, ruta, { readonly = false } = {}) {
            const hay = await almacen.existe(ruta);
            if (!hay && readonly) throw new Error(`No existe el banco «${ruta}».`);
            const bytes = hay ? await almacen.leer(ruta) : null;
            /* Un archivo de 0 bytes (catálogo recién creado por el gestor) equivale a banco nuevo. */
            return abrirAdaptadorSqlite({ bytes: bytes?.length ? bytes : null, rutaWasm, onCambios });
        },
        instantanea: (db) => db.exportar(),
        userVersion,
        integridad,
        /* sql.js no tiene archivos WAL: la BD entera vive en memoria. */
        puntoControl: () => {},
        /* sql.js no escribe en el almacén: el gestor debe volcar catálogo y banco (F4.4). */
        soloMemoria: true,
    };
}

export const driverWasm = crearDriverWasm();
