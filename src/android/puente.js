/* Puente Android (task 11): abre el banco con SQLite WASM, persiste los cambios en el
   almacenamiento privado de la app y expone el núcleo al WebView (window.__opios).
   No hay Bun.serve ni bun:sqlite: solo adaptador-sqlite-wasm + local.js. */
import { Filesystem, Directory } from "@capacitor/filesystem";
import { abrirAdaptadorSqlite, aBase64 } from "../adaptador-sqlite-wasm.js";
import { abrirRepo } from "../db/index.js";
import { crearAppLocal } from "../local.js";

const ARCHIVO = "banco/banco.db";

export async function arrancar() {
    let bytes = null;
    try {
        const guardado = await Filesystem.readFile({ path: ARCHIVO, directory: Directory.Data });
        bytes = guardado.data; // base64 (binario sin codificar)
    } catch {
        /* primera ejecución: banco nuevo vacío */
    }

    /* Los cambios se guardan en cadena: nunca dos writeFile a la vez sobre el mismo archivo.
       shortcut: se reescribe el banco entero en cada escritura (simple y sin corrupción a
       medias); pasar a escrituras incrementales/WAL si el banco crece o si se nota el coste. */
    let cadena = Promise.resolve();
    const db = await abrirAdaptadorSqlite({
        bytes,
        onCambios: (shim) => {
            const bytesActuales = aBase64(shim.exportar());
            cadena = cadena.then(() =>
                Filesystem.writeFile({ path: ARCHIVO, directory: Directory.Data, data: bytesActuales, recursive: true }),
            );
        },
    });
    const repo = abrirRepo(db);
    globalThis.__opios = crearAppLocal(repo);
    return repo;
}
