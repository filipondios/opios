/* Almacén con el sistema de archivos privado del WebView (F2.1): Capacitor Filesystem sobre
   `Directory.Data`. Filesystem trabaja en base64, así que aquí se codifica/decodifica; el
   contrato del almacén entrega y recibe Uint8Array. `Filesystem` y `Directory` se pueden
   inyectar para probarlo sin Capacitor. */
import { Directory, Filesystem } from "@capacitor/filesystem";
import { aBase64, deBase64 } from "./adaptador-sqlite-wasm.js";

export function crearAlmacenCapacitor(fs = Filesystem, dir = Directory.Data) {
    return {
        existe: async (ruta) => {
            try {
                await fs.stat({ path: ruta, directory: dir });
                return true;
            } catch {
                return false;
            }
        },
        leer: async (ruta) => deBase64((await fs.readFile({ path: ruta, directory: dir })).data),
        escribir: async (ruta, bytes) => {
            await fs.writeFile({ path: ruta, directory: dir, data: aBase64(bytes), recursive: true });
        },
        renombrar: async (de, a) => {
            await fs.rename({ from: de, to: a, directory: dir });
        },
        borrar: async (ruta) => {
            try {
                await fs.deleteFile({ path: ruta, directory: dir });
            } catch {
                /* no existía */
            }
        },
        listar: async (carpeta) => (await fs.readdir({ path: carpeta, directory: dir })).files.map((f) => f.name),
    };
}
