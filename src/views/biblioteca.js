import { html } from "./html.js";
import { layout } from "./layout.js";

/** Biblioteca (F3.2): el catálogo de bancos. Las tarjetas las pinta el cliente
    (public/js/biblioteca.js) a partir de /api/bancos; aquí solo el contenedor. */
export function paginaBiblioteca() {
    return layout({
        titulo: "Biblioteca",
        actual: "biblioteca",
        css: ["biblioteca.css"],
        js: ["biblioteca.js"],
        estado: "Cargando biblioteca…",
        cuerpo: html`<main class="biblioteca">
  <div id="biblioteca-caja"><p>Cargando la biblioteca…</p></div>
</main>`,
    });
}
