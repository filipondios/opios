import { html } from "./html.js";
import { layout } from "./layout.js";
import { etiquetaTema } from "../etiquetas.js";

function selectorTemas(temario) {
  const bloques = temario.filter((b) => b.temas.length);
  if (!bloques.length) return html`<p class="empty">Todavía no hay temas con preguntas. Añade preguntas o importa un banco.</p>`;
  return bloques.map((b) => html`
    <section class="bloque-sel" data-bloque="${b.id}">
      <div class="bloque-sel-head">
        <h3>${b.nombre}</h3>
        <button class="btn small" type="button" data-bloque="${b.id}">Todo el bloque</button>
      </div>
      <div class="temas-checks">${b.temas.map((t) => html`
        <label class="tema-check">
          <input type="checkbox" name="tema" value="${t.id}" data-total="${t.preguntas}" checked>
          <span class="tema-check-name">${etiquetaTema(t, { bloque: false })}</span>
          <span class="tema-check-n">${t.preguntas}</span>
        </label>`)}</div>
    </section>`);
}

export function paginaSimulacro({ temario }) {
  const hayTemas = temario.some((b) => b.temas.length);
  const cuerpo = html`
  <div id="note" class="note" hidden></div>

  <!-- ============ PANTALLA: preparar ============ -->
  <main id="screen-setup" class="stack">
    <div class="page-head">
      <div>
        <h1>Simulacro</h1>
        <p class="lede">Como el examen: preguntas mezcladas, tiempo límite y corrección al final. Sirve para medir tu ritmo y tus puntos débiles, no para memorizar.</p>
      </div>
      <a class="btn" href="/">Volver al test</a>
    </div>

    ${hayTemas ? html`
    <section class="card stack">
      <div class="row">
        <h2>Temas</h2>
        <span class="spacer"></span>
        <button class="btn small" type="button" id="btn-todos">Todos</button>
        <button class="btn small" type="button" id="btn-ninguno">Ninguno</button>
      </div>
      <div id="temas" class="temas-sel">${selectorTemas(temario)}</div>
    </section>

    <section class="card stack">
      <h2>Condiciones</h2>
      <div class="exam-config">
        <label class="field"><span>Preguntas</span><input id="cfg-n" type="number" min="5" max="200" value="50" inputmode="numeric"></label>
        <label class="field"><span>Minutos</span><input id="cfg-min" type="number" min="1" max="300" value="60" inputmode="numeric"></label>
        <label class="field"><span>Penalización por fallo</span>
          <select id="cfg-pen">
            <option value="0">Sin penalización</option>
            <option value="0.25">1/4 por fallo</option>
            <option value="0.3333" selected>1/3 por fallo</option>
            <option value="0.5">1/2 por fallo</option>
          </select>
        </label>
      </div>
      <p class="hint" id="cfg-resumen"></p>
    </section>

    <div class="row">
      <button class="btn primary" type="button" id="btn-empezar">Empezar simulacro</button>
      <span class="hint">Las respuestas no se corrigen hasta el final.</span>
    </div>` : html`
    <section class="stack">
      <p class="empty">No hay preguntas para simular. <a href="/maker">Añade preguntas</a> o <a href="/temario">revisa el temario</a>.</p>
    </section>`}
  </main>

  <!-- ============ PANTALLA: examen ============ -->
  <main id="screen-exam" class="stack" hidden>
    <div class="exam-bar">
      <span class="timer" id="exam-timer" data-low="false">60:00</span>
      <span class="exam-progress" id="exam-progress"></span>
      <span class="spacer"></span>
      <button class="btn small danger" type="button" id="btn-salir">Salir</button>
    </div>

    <article class="qcard">
      <div class="qbar">
        <div class="tags"><span class="tag" id="exam-tema"></span></div>
        <div class="score"><span id="exam-answered"></span></div>
      </div>
      <h2 class="qtext" id="exam-text"></h2>
      <div class="opts" id="exam-opts" role="radiogroup" aria-labelledby="exam-text"></div>
    </article>

    <div class="exam-nav">
      <button class="btn" type="button" id="btn-prev">Anterior</button>
      <div id="exam-palette" class="palette" role="group" aria-label="Ir a una pregunta"></div>
      <button class="btn primary" type="button" id="btn-next">Siguiente</button>
    </div>

    <div class="row">
      <button class="btn danger" type="button" id="btn-finish">Finalizar</button>
      <span class="hint">Puedes dejar preguntas en blanco.</span>
    </div>

    <p class="keys">
      <span><kbd>↑</kbd><kbd>↓</kbd> elegir</span>
      <span><kbd>←</kbd><kbd>→</kbd> navegar</span>
      <span><kbd>Enter</kbd> responder y siguiente</span>
      <span><kbd>Esc</kbd> salir</span>
    </p>
    <div class="sr" id="sr" aria-live="polite"></div>
  </main>

  <!-- ============ PANTALLA: resultados ============ -->
  <main id="screen-results" class="stack" hidden>
    <div class="page-head">
      <div>
        <h1>Resultado del simulacro</h1>
        <p class="lede" id="res-sub"></p>
      </div>
      <a class="btn" href="/">Volver al test</a>
    </div>

    <section id="res-kpis" class="kpis" aria-label="Resumen del simulacro"></section>

    <section class="card stack">
      <h2>Por tema</h2>
      <div class="tabla-wrap"><table class="tabla" id="res-temas"></table></div>
    </section>

    <section class="stack">
      <div class="row">
        <h2>Revisión</h2>
        <span class="spacer"></span>
        <label class="hint check-inline"><input type="checkbox" id="res-solo-fallos" checked> Solo fallos y blancos</label>
      </div>
      <div id="res-revision" class="stack"></div>
    </section>

    <div class="row">
      <button class="btn primary" type="button" id="btn-repetir">Repetir</button>
      <a class="btn" href="/simulacro">Nuevo simulacro</a>
      <a class="btn" href="/estadisticas">Ver estadísticas</a>
    </div>
  </main>`;

  return layout({
    titulo: "Simulacro",
    marca: "Simulacro",
    enlaces: [
      { href: "/", texto: "Hacer test" },
      { href: "/estadisticas", texto: "Estadísticas" },
      { href: "/temario", texto: "Temario" },
    ],
    estado: "Guardado en la base de datos",
    css: ["test.css", "estadisticas.css", "simulacro.css"],
    js: ["etiquetas.js", "resultado.js", "simulacro.js"],
    cuerpo,
  });
}
