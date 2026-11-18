/* Almacén con el sistema de archivos privado del WebView (F2.1): Capacitor Filesystem sobre
   `Directory.Data`. Filesystem trabaja en base64, así que aquí se codifica/decodifica; el
   contrato del almacén entrega y recibe Uint8Array. `Filesystem` y `Directory` se pueden
   inyectar para probarlo sin Capacitor. */
import { Directory, Filesystem } from "@capacitor/filesystem";
import { aBase64, deBase64 } from "./adaptador-sqlite-wasm.js";

/* El proxy ESM de @capacitor/filesystem no resuelve writeFile en este WebView; el que expone
   Capacitor en global sí. Se resuelve en cada llamada porque el bridge se inyecta después de
   cargar el módulo. Los tests inyectan `fs`, así que no cambia el contrato. */
export function crearAlmacenCapacitor(fs, dir = Directory.Data) {
    const plugin = () => fs ?? globalThis.Capacitor?.Plugins?.Filesystem ?? Filesystem;
    return {
        existe: async (ruta) => {
            try {
                await plugin().stat({ path: ruta, directory: dir });
                return true;
            } catch {
                return false;
            }
        },
        leer: async (ruta) => deBase64((await plugin().readFile({ path: ruta, directory: dir })).data),
        escribir: async (ruta, bytes) => {
            await plugin().writeFile({ path: ruta, directory: dir, data: aBase64(bytes), recursive: true });
        },
        renombrar: async (de, a) => {
            await plugin().rename({ from: de, to: a, directory: dir });
        },
        borrar: async (ruta) => {
            try {
                await plugin().deleteFile({ path: ruta, directory: dir });
            } catch {
                /* no existía */
            }
        },
        listar: async (carpeta) => (await plugin().readdir({ path: carpeta, directory: dir })).files.map((f) => f.name),
    };
}
