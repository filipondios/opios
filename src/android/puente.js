/* Puente Android (task 11, F1.4): abre el banco con SQLite WASM, lo persiste de forma atómica
   en el almacenamiento privado de la app y expone el núcleo al WebView (window.__opios).
   No hay Bun.serve ni bun:sqlite: solo adaptador-sqlite-wasm + local.js. */
import { App } from "@capacitor/app";
import { abrirAdaptadorSqlite, integroSqlite } from "../adaptador-sqlite-wasm.js";
import { crearAlmacenCapacitor } from "../almacen-capacitor.js";
import { idBanco } from "../banco-id.js";
import { abrirRepo } from "../db/index.js";
import { crearAppLocal } from "../local.js";
import { crearPersistencia } from "./persistencia.js";

const ARCHIVO = "banco/banco.db";

/* Almacén sobre el sistema de archivos privado de la app (F1.4, F2.1). */
const almacen = crearAlmacenCapacitor();

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
