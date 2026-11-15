/* Puente Android (task 11, F1.4): abre el banco con SQLite WASM, lo persiste de forma atómica
   en el almacenamiento privado de la app y expone el núcleo al WebView (window.__opios).
   No hay Bun.serve ni bun:sqlite: solo adaptador-sqlite-wasm + local.js. */
import { App } from "@capacitor/app";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { abrirAdaptadorSqlite, aBase64, deBase64, integroSqlite } from "../adaptador-sqlite-wasm.js";
import { idBanco } from "../banco-id.js";
import { abrirRepo } from "../db/index.js";
import { crearAppLocal } from "../local.js";
import { crearPersistencia } from "./persistencia.js";

const ARCHIVO = "banco/banco.db";

/* Almacén sobre el sistema de archivos privado de la app (F1.4). */
const almacen = {
    existe: async (ruta) => {
        try {
            await Filesystem.stat({ path: ruta, directory: Directory.Data });
            return true;
        } catch {
            return false;
        }
    },
    leer: async (ruta) => deBase64((await Filesystem.readFile({ path: ruta, directory: Directory.Data })).data),
    escribir: (ruta, bytes) =>
        Filesystem.writeFile({ path: ruta, directory: Directory.Data, data: aBase64(bytes), recursive: true }),
    mover: (de, a) => Filesystem.rename({ from: de, to: a, directory: Directory.Data }),
    borrar: (ruta) => Filesystem.deleteFile({ path: ruta, directory: Directory.Data }),
};

export async function arrancar() {
    let shim = null;
    const persistencia = crearPersistencia({
        almacen,
        ruta: ARCHIVO,
        exportar: () => shim.exportar(),
        integro: (bytes) => integroSqlite(bytes),
    });

    const bytes = await persistencia.abrir();
    shim = await abrirAdaptadorSqlite({ bytes, onCambios: () => persistencia.cambios() });
    const repo = abrirRepo(shim);

    /* Al pasar a segundo plano se guarda ya: el debounce esperaría demasiado. */
    const flush = () => {
        persistencia.flush().catch(() => {});
    };
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", flush);
    App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) flush();
    });
    App.addListener("pause", flush);

    /* El WebView no tiene `process.env`: la zona es la del dispositivo. El id del banco (F1.5)
       se inyecta en las páginas para prefijar las claves de localStorage por banco. */
    globalThis.__opios = crearAppLocal(repo, {
        zona: Intl.DateTimeFormat().resolvedOptions().timeZone,
        banco: idBanco(repo),
    });
    return repo;
}
