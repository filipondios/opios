import { html } from "./html.js";
import { layout } from "./layout.js";

/** Página HTML para rutas que no existen fuera de /api. */
export function paginaNoEncontrada(ruta = "") {
  return layout({
    titulo: "Página no encontrada",
    actual: null,
    estado: "Error 404",
    estadoTipo: "warn",
    cuerpo: html`<main class="stack">
      <div class="page-head">
        <div>
          <h1>Página no encontrada</h1>
          <p class="lede">No hay nada en <code>${ruta}</code>. Puede que el enlace esté mal escrito o que la página ya no exista.</p>
        </div>
      </div>
      <div class="row">
        <a class="btn primary" href="/">Volver al test</a>
        <a class="btn" href="/temario">Ver el temario</a>
        <a class="btn" href="/estadisticas">Estadísticas</a>
      </div>
    </main>`,
  });
}
