/* Shell del WebView (task 11): monta cada ruta desde el núcleo local (src/local.js) y
   engancha la navegación. Los estáticos (css, js, wasm) los sirve Capacitor.
   Cada ruta se escribe en un documento nuevo con document.write —igual que una carga del
   servidor— para que los módulos de página corran una sola vez por visita: si se inyectara
   el HTML con innerHTML, los listeners de document/window se irían acumulando.
   Reejecutado tras cada escritura (lo inyecta prepararPagina), arranca el banco solo la
   primera vez y no vuelve a pintar la ruta ya pintada. */
import { prepararPagina } from "./pagina.js";
import { arrancar, conectarEventos } from "./puente.js";

/* Sin banco activo, las secciones que consultan el repo responden 503. Entra por la
   biblioteca (o el temario, que no necesita banco) para no dejar una página sin menú. */
const SIN_BANCO = ["/biblioteca", "/temario"];
const segura = (ruta) => (globalThis.__opiosSinBanco && !SIN_BANCO.includes(ruta) ? "/biblioteca" : ruta);

async function mostrarRuta(ruta, { empujar = true } = {}) {
    const r = await globalThis.__opios(new Request("http://opios.local" + segura(ruta)));
    if (!r.ok) throw new Error("Ruta no disponible: " + ruta);
    globalThis.__opiosRuta = ruta; // antes de document.open: si el documento se reemplaza, no se reintenta
    /* Marca las entradas que empujó la app: así el botón Atrás distingue «volver» de
       «salir» aunque la app se abra directamente en una ruta profunda (sin historial). */
    if (empujar) history.pushState({ opios: true }, "", ruta);
    const html = prepararPagina(await r.text(), "?r=" + Date.now());
    document.open();
    document.write(html);
    document.close();
}

/* Navegación única de la app: si una sección falla vuelve a la biblioteca (con menú), y se
   expone para que el botón «Estudiar» espere a activar el banco antes de cambiar de página. */
function ir(ruta, empujar = true) {
    const destino = segura(ruta);
    return mostrarRuta(destino, { empujar })
        .catch(() => (destino === "/biblioteca" ? null : ir("/biblioteca", empujar)))
        .catch(() => (location.href = "/biblioteca"));
}
globalThis.__opiosIr = ir;

document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href^='/']");
    if (!a || e.defaultPrevented || a.target || a.hasAttribute("download") || e.metaKey || e.ctrlKey || e.altKey)
        return;
    const ruta = a.getAttribute("href");
    e.preventDefault();
    if (globalThis.__opiosOcupado) return; // 6.4: no se navega mientras se está escribiendo
    ir(ruta);
});

window.addEventListener("popstate", () => mostrarRuta(location.pathname, { empujar: false }).catch(() => {}));

if (!globalThis.__opios) await arrancar();
if (!globalThis.__opiosRuta) {
    /* Sin banco activo (instalación nueva o tras borrar el último): entra por la biblioteca. */
    const ruta = segura(location.pathname);
    if (ruta !== location.pathname) history.replaceState({ opios: true }, "", ruta);
    await ir(ruta, false);
}
/* Cada document.write ejecuta el shell de nuevo: engancha los listeners en el documento vivo. */
conectarEventos();
