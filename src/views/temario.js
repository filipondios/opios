import { html } from "./html.js";
import { layout } from "./layout.js";

/** Página de gestión del temario: bloques y temas. El cliente la pinta a partir de /api/temario. */
export function paginaTemario() {
  const cuerpo = html`
  <div id="note" class="note" hidden></div>

  <main class="stack">
    <div class="page-head">
      <div>
        <h1>Temario</h1>
        <p class="lede">Agrupa los temas en bloques y numéralos dentro de cada bloque. El número que aparece aquí es el que se muestra en el test y en el creador.</p>
      </div>
      <button class="btn primary" type="button" id="btn-nuevo-bloque">Nuevo bloque</button>
    </div>

    <p class="empty" id="vacio" hidden>Todavía no hay bloques. Crea el primero para empezar a organizar los temas.</p>
    <div id="bloques" class="stack"></div>
  </main>

  <dialog id="dlg" class="dlg" aria-labelledby="dlg-title">
    <form id="dlg-form">
      <h2 id="dlg-title">Nuevo bloque</h2>
      <div id="dlg-campos" class="stack"></div>
      <div class="err" id="dlg-error" role="alert" hidden></div>
      <div class="row">
        <button class="btn" type="button" id="dlg-cancel">Cancelar</button>
        <span class="spacer"></span>
        <button class="btn primary" type="submit" id="dlg-ok">Guardar</button>
      </div>
    </form>
  </dialog>`;

  return layout({
    titulo: "Temario",
    marca: "Temario",
    enlaces: [{ href: "/", texto: "Hacer test" }, { href: "/maker", texto: "Añadir preguntas" }],
    estado: "Guardado en la base de datos",
    css: ["maker.css", "temario.css"],
    js: ["temario.js"],
    cuerpo,
  });
}
