/* Puente Android (task 11, F1.4, F4.4): abre el banco con SQLite WASM, lo persiste de forma
   atómica en el almacenamiento privado de la app y expone el núcleo al WebView (window.__opios).
   No hay Bun.serve ni bun:sqlite: solo adaptador-sqlite-wasm + local.js. Desde F4.4 hay
   biblioteca: catálogo de bancos (`DatabaseManager`) sobre el mismo almacén privado. */
import { App } from "@capacitor/app";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { crearAlmacenCapacitor } from "../almacen-capacitor.js";
import { idBanco } from "../banco-id.js";
import { crearDriverWasm } from "../driver-wasm.js";
import { abrirRepo } from "../db/index.js";
import { ErrorApi } from "../errores.js";
import { DatabaseManager } from "../gestor-bancos.js";
import { crearAppLocal } from "../local.js";

/* Catálogo y bancos en el almacenamiento privado (junto al antiguo banco único, F1.4). */
const CATALOGO = "banco/catalogo.db";
const LEGACY = "banco/banco.db";

const almacen = crearAlmacenCapacitor();

/* El plugin copia cada archivo elegido a la caché; si se interrumpió una importación, esos
   temporales sobran. Se limpian al arrancar (F4.4). */
async function limpiarTemporales() {
    try {
        const { files } = await Filesystem.readdir({ path: "", directory: Directory.Cache });
        for (const f of files)
            if (f.name.startsWith("importado-"))
                await Filesystem.deleteFile({ path: f.name, directory: Directory.Cache }).catch(() => {});
    } catch {
        /* sin caché o vacía */
    }
}

export async function arrancar() {
    await limpiarTemporales();

    /* Guardado con debounce (sql.js no escribe solo): cada escritura del adaptador avisa. */
    let avisar = () => {};
    const driver = crearDriverWasm({ onCambios: () => avisar() });
    const gestor = new DatabaseManager({ almacen, driver, rutaCatalogo: CATALOGO });

    /* Sin catálogo: el banco único antiguo (F1.4) pasa a ser un banco del catálogo y, si
       tampoco existe, se crea uno vacío. Así la app siempre arranca con un banco activo. */
    if (!(await gestor.idActivo())) {
        try {
            if (!(await almacen.existe(LEGACY))) {
                const repo = abrirRepo(await driver.abrir(almacen, LEGACY));
                idBanco(repo);
                await almacen.escribir(LEGACY, driver.instantanea(repo.db));
                repo.close();
            }
            const b = await gestor.registrar("Mi banco", LEGACY);
            await gestor.activar(b.id);
            await gestor.persistir();
        } catch (e) {
            console.error("No se pudo preparar el banco inicial:", e?.message ?? e);
        }
    }

    let repoActual = null;
    try {
        repoActual = await gestor.abrirActivo();
    } catch {
        /* Banco activo ausente (F3.8): la biblioteca sirve para localizar o activar otro. */
    }

    let pendiente = null;
    const guardar = () => {
        if (pendiente) return;
        pendiente = setTimeout(async () => {
            pendiente = null;
            await gestor.persistirBanco().catch(() => {});
        }, 400);
    };
    const flush = () => {
        if (pendiente) {
            clearTimeout(pendiente);
            pendiente = null;
        }
        return gestor.persistirBanco().catch(() => {});
    };
    avisar = guardar;

    /* El repo activo cambia en caliente al activar otro banco (F2.8/F3.1). */
    const repo = new Proxy(
        {},
        {
            get: (_, k) => {
                if (!repoActual)
                    throw new ErrorApi(
                        503,
                        "El banco activo no está disponible: localiza su archivo o activa otro banco en /biblioteca.",
                    );
                const v = repoActual[k];
                return typeof v === "function" ? v.bind(repoActual) : v;
            },
        },
    );

    /* Al pasar a segundo plano se guarda ya: el debounce esperaría demasiado. */
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", () => flush());
    App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) flush();
    });
    App.addListener("pause", () => flush());

    /* Botón Atrás (6.2): vuelve dentro de la app; solo desde la portada pide confirmación
       para salir. `arrancar()` corre una sola vez, así que el listener no se acumula. */
    App.addListener("backButton", () => {
        if (globalThis.__opiosOcupado) return; // 6.4
        if (location.pathname !== "/" && history.state?.opios) history.back();
        else if (confirm("¿Salir de Opios?")) App.exitApp();
    });

    /* El WebView no tiene `process.env`: la zona es la del dispositivo. El id del banco (F1.5)
       se inyecta en las páginas para prefijar las claves de localStorage por banco. */
    globalThis.__opios = crearAppLocal(repo, {
        zona: Intl.DateTimeFormat().resolvedOptions().timeZone,
        banco: () => (repoActual ? idBanco(repoActual) : null),
        gestor,
        alActivar: async (nuevo) => {
            repoActual = nuevo;
            guardar(); // el banco recién abierto también debe quedar en disco
        },
    });
    return repo;
}
