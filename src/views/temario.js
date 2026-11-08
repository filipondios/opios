import { html } from "./html.js";
import { layout } from "./layout.js";
import { MAX_BLOQUE, MAX_TEMA_NOMBRE } from "../config.js";

/** Página de gestión del temario: bloques y temas. El cliente la pinta a partir de /api/temario. */
export function paginaTemario() {
    const cuerpo = html`
  <div id="note" class="note" hidden></div>

  <main class="stack" id="temario" data-max-bloque="${MAX_BLOQUE}" data-max-tema="${MAX_TEMA_NOMBRE}">
    <div class="page-head">
      <div>
        <h1>Temario</h1>
        <p class="lede">Agrupa los temas en bloques y numéralos dentro de cada bloque. El número que aparece aquí es el que se muestra en el test y en el creador.</p>
      </div>
      <button class="btn primary" type="button" id="btn-nuevo-bloque">Nuevo bloque</button>
    </div>

    <p class="empty" id="vacio" hidden>Todavía no hay bloques. Si tienes un banco de preguntas, apunta <code>OPIOS_PREGUNTAS</code> a su carpeta y ejecuta <code>bun run seed</code>; si no, crea el primer bloque aquí.</p>
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
        actual: "temario",
        estado: "Guardado en la base de datos",
        css: ["maker.css", "temario.css"],
        js: ["temario.js"],
        cuerpo,
    });
}
