import { html } from "./html.js";
import { layout } from "./layout.js";
import { MAX_ETIQUETA } from "../config.js";

/** Recorta una etiqueta larga para que los desplegables no ocupen toda la pantalla. */
const recortar = (s, max = MAX_ETIQUETA) => (s.length > max ? s.slice(0, max - 3).trimEnd() + "..." : s);
const etiquetaTema = (t) => `Tema ${t.numero ?? t.id}${t.nombre ? ` — ${t.nombre}` : ""}`;
const tituloBloque = (b) => recortar(b.nombre);

/** Opciones del filtro de la lista, agrupadas por bloque. */
export function opcionesFiltro(temario, total) {
  return html`<option value="">Todos los temas (${total})</option>${temario.filter((b) => b.temas.length).map((b) => html`
    <optgroup label="${tituloBloque(b)}">${b.temas.map((t) => html`<option value="${t.id}">${recortar(etiquetaTema(t) + ` (${t.preguntas})`)}</option>`)}</optgroup>`)}`;
}

/** Opciones del selector de tema del editor, agrupadas por bloque. */
export function opcionesTema(temario, seleccionado = "") {
  if (!temario.some((b) => b.temas.length)) return html`<option value="">No hay temas todavía</option>`;
  return html`${temario.filter((b) => b.temas.length).map((b) => html`
    <optgroup label="${tituloBloque(b)}">${b.temas.map((t) => html`<option value="${t.id}"${String(t.id) === String(seleccionado) ? " selected" : ""}>${recortar(etiquetaTema(t) + (t.preguntas === 0 ? " (sin preguntas)" : ""))}</option>`)}</optgroup>`)}`;
}

export function paginaMaker({ temario }) {
  const total = temario.reduce((s, b) => s + b.temas.reduce((x, t) => x + t.preguntas, 0), 0);
  const cuerpo = html`
  <div class="cols">
    <!-- ============ Editor ============ -->
    <section class="card" aria-labelledby="ed-title">
      <div class="card-head">
        <h1 id="ed-title">Nueva pregunta</h1>
        <span class="tagline" id="ed-mode"></span>
      </div>

      <div class="tema-row">
        <div class="field">
          <label for="f-tema">Tema</label>
          <select id="f-tema" autocomplete="off">${opcionesTema(temario)}</select>
        </div>
        <a class="btn small" href="/temario">Organizar temario</a>
      </div>

      <div class="field">
        <label for="f-preg">Pregunta</label>
        <textarea id="f-preg" rows="3" autocomplete="off"></textarea>
      </div>

      <fieldset>
        <legend>Opciones</legend>
        <div id="f-opts"></div>
        <div class="row">
          <button class="btn small" type="button" id="btn-add-opt">+ Añadir opción</button>
          <span class="hint">Pulsa Enter para pasar a la siguiente opción.</span>
        </div>
      </fieldset>

      <fieldset>
        <legend id="lg-correct">Respuesta correcta</legend>
        <div class="pills" id="f-correct" role="radiogroup" aria-labelledby="lg-correct"></div>
        <p class="hint mt">Por defecto es la A: escribe primero la correcta y luego las incorrectas. En el test se barajan. Puedes elegir otra con las flechas o haciendo clic en la letra.</p>
      </fieldset>

      <div class="field">
        <label for="f-expl">Explicación <span class="opt-tag">(opcional, se muestra al fallar)</span></label>
        <textarea id="f-expl" rows="3" autocomplete="off"></textarea>
      </div>

      <div class="err" id="f-error" role="alert" hidden></div>

      <div class="row">
        <button class="btn primary" type="button" id="btn-save"></button>
        <button class="btn" type="button" id="btn-cancel" hidden>Cancelar edición</button>
        <button class="btn" type="button" id="btn-clear">Limpiar</button>
        <span class="flash" id="flash" role="status" aria-live="polite"></span>
      </div>
    </section>

    <!-- ============ Lista ============ -->
    <div class="stack">
      <section class="card" aria-labelledby="list-title">
        <div class="list-head">
          <h2 id="list-title">Preguntas <span class="mono" id="count" style="font-size:15px;color:var(--ink-2)"></span></h2>
          <div class="filters">
            <input id="f-buscar" type="search" placeholder="Buscar en el enunciado" aria-label="Buscar en el enunciado" autocomplete="off">
            <select id="f-filtro" aria-label="Filtrar por tema">${opcionesFiltro(temario, total)}</select>
          </div>
        </div>
        <p class="empty" id="empty" hidden>No hay preguntas con ese filtro.</p>
        <ul class="items" id="list"></ul>
        <div class="row">
          <button class="btn small" type="button" id="btn-more" hidden>Mostrar más</button>
        </div>
      </section>

      <section class="card" aria-labelledby="exp-title">
        <h2 id="exp-title">Copia de seguridad</h2>
        <p class="hint">Las preguntas se guardan directamente en la base de datos (<span class="mono">data/opios.db</span>). Si quieres una copia en el formato JSON de siempre, puedes descargarla aquí.</p>
        <div class="row">
          <a class="btn" href="/api/exportar" download="preguntas.json">Descargar preguntas (JSON)</a>
        </div>
      </section>
    </div>
  </div>`;

  return layout({
    titulo: "Creador de preguntas",
    marca: "Creador de preguntas",
    enlace: { href: "/", texto: "Hacer test" },
    estado: "Guardado en la base de datos",
    ancho: true,
    css: ["maker.css"],
    js: ["maker.js"],
    cuerpo,
  });
}
