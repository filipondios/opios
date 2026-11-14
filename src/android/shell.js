/* Shell del WebView (task 11): monta cada ruta desde el núcleo local (src/local.js) y
   engancha la navegación. Los estáticos (css, js, wasm) los sirve Capacitor.
   Cada ruta se escribe en un documento nuevo con document.write —igual que una carga del
   servidor— para que los módulos de página corran una sola vez por visita: si se inyectara
   el HTML con innerHTML, los listeners de document/window se irían acumulando.
   Reejecutado tras cada escritura (lo inyecta prepararPagina), arranca el banco solo la
   primera vez y no vuelve a pintar la ruta ya pintada. */
import { prepararPagina } from "./pagina.js";
import { arrancar } from "./puente.js";

async function mostrarRuta(ruta, { empujar = true } = {}) {
    const r = await globalThis.__opios(new Request("http://opios.local" + ruta));
    if (!r.ok) throw new Error("Ruta no disponible: " + ruta);
    globalThis.__opiosRuta = ruta; // antes de document.open: si el documento se reemplaza, no se reintenta
    if (empujar) history.pushState({}, "", ruta);
    const html = prepararPagina(await r.text(), "?r=" + Date.now());
    document.open();
    document.write(html);
    document.close();
}

document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href^='/']");
    if (!a || a.target || a.hasAttribute("download") || e.metaKey || e.ctrlKey || e.altKey) return;
    const ruta = a.getAttribute("href");
    e.preventDefault();
    mostrarRuta(ruta).catch(() => (location.href = ruta)); // sin puente: navegación clásica
});

window.addEventListener("popstate", () => mostrarRuta(location.pathname, { empujar: false }).catch(() => {}));

if (!globalThis.__opios) await arrancar();
if (!globalThis.__opiosRuta)
    await mostrarRuta(location.pathname, { empujar: false }).catch((e) => {
        document.body.textContent = "No se pudo abrir el banco de preguntas: " + (e?.message ?? e);
    });
