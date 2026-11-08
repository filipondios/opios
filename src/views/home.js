import { html, raw } from "./html.js";
import { layout } from "./layout.js";

/** Una ficha por tema, con barra de progreso. Los data-* los usa el cliente para el resumen. */
function chip(t) {
  const pct = (n) => (n / t.total * 100).toFixed(2);
  const numero = t.tema_numero ?? t.tema;
  return html`<button class="chip" type="button" role="checkbox" aria-checked="false"
      data-tema="${t.tema}" data-total="${t.total}" data-nuevas="${t.nuevas}" data-repaso="${t.repaso}"
      ${t.tema_nombre ? html`title="${t.tema_nombre}"` : ""}>
    <span class="chip-top"><span class="chip-label">Tema</span><span class="chip-num">${numero}</span></span>
    ${t.tema_nombre ? html`<span class="chip-name">${t.tema_nombre}</span>` : ""}
    <span class="chip-meta">${t.total} ${t.total === 1 ? "pregunta" : "preguntas"}</span>
    <span class="bar" aria-hidden="true">
      <i class="b-ok" style="width:${pct(t.dominadas)}%"></i><i class="b-mid" style="width:${pct(t.aprendiendo)}%"></i><i class="b-new" style="width:${pct(t.nuevas)}%"></i>
    </span>
    <span class="chip-due">${t.repaso ? `${t.repaso} por repasar hoy` : "Sin repasos hoy"}</span>
  </button>`;
}

/** Atributos de datos con la carga del día; el cliente los lee para mostrar el cupo y limitar las nuevas. */
function datosCarga(carga) {
  if (!carga) return "";
  return `data-nuevas-hoy="${carga.nuevasHoy}" data-cupo-nuevas="${carga.cupoNuevas}" `
    + `data-repasos="${carga.repasosPendientes}" data-atrasados="${carga.repasosAtrasados}" `
    + `data-bloqueado="${carga.bloqueadoPorAtraso ? 1 : 0}"`;
}

/** Texto del cupo diario; el mismo resumen lo recalcula el cliente al refrescar los temas. */
export function textoCarga(carga) {
  if (!carga) return "";
  const restantes = Math.max(0, carga.cupoNuevas - carga.nuevasHoy);
  const partes = [`Nuevas hoy: ${carga.nuevasHoy}/${carga.cupoNuevas}`];
  if (carga.repasosPendientes) partes.push(`${carga.repasosPendientes} por repasar`);
  if (carga.bloqueadoPorAtraso) partes.push(`frenado: ${carga.repasosAtrasados} repasos atrasados`);
  else if (restantes === 0) partes.push("cupo de nuevas agotado hoy");
  return partes.join(" · ");
}

/** Texto con los días que quedan y el tope de intervalo derivado (Fase 3.6). */
export function textoExamen(examen) {
  if (!examen || !examen.fecha) return "";
  if (examen.dias == null || examen.dias <= 0) return "La fecha de examen ya ha pasado.";
  return `${examen.dias} día${examen.dias === 1 ? "" : "s"} hasta el examen · los repasos se acortan a ${examen.topeDias} día${examen.topeDias === 1 ? "" : "s"}`;
}

/** Rejilla de temas agrupada por bloques del temario. */
export function temasGrid(temas, carga = null) {
  const bloques = [];
  const porBloque = new Map();
  for (const t of temas) {
    const clave = t.bloque ?? "sin";
    if (!porBloque.has(clave)) {
      const g = { id: t.bloque ?? null, nombre: t.bloque_nombre || "Sin bloque", temas: [] };
      porBloque.set(clave, g);
      bloques.push(g);
    }
    porBloque.get(clave).temas.push(t);
  }
  return html`<div class="carga" hidden ${raw(datosCarga(carga))}></div>${bloques.map((b) => html`
    <section class="bloque" data-bloque="${b.id ?? ""}">
      <div class="bloque-head">
        <h2>${b.nombre}</h2>
        <span>${b.temas.length} ${b.temas.length === 1 ? "tema" : "temas"} · ${b.temas.reduce((s, t) => s + t.total, 0)} preguntas</span>
        <button class="btn small sel-bloque" type="button" data-bloque="${b.id ?? ""}">Todo el bloque</button>
      </div>
      <div class="grid">${b.temas.map(chip)}</div>
    </section>`)}`;
}

export function paginaHome({ temas, carga = null, examen = null }) {
  const vacio = temas.length === 0;
  const cuerpo = html`
  <div id="note" class="note" hidden></div>

  <!-- ============ PANTALLA: preparar ============ -->
  <main id="screen-setup" class="stack">
    ${vacio ? html`
    <section id="empty" class="stack">
      <h1>Todavía no hay preguntas</h1>
      <p class="lede">La base de datos está vacía. Apunta <code>OPIOS_PREGUNTAS</code> a la carpeta de tu banco y ejecuta <code>bun run seed</code>, o crea preguntas desde el creador. Sin configurar nada, la app usa el banco de ejemplo de <code>ejemplo/</code>.</p>
      <div class="row"><a class="btn primary" href="/maker">Añadir preguntas</a><a class="btn" href="/temario">Organizar temario</a></div>
    </section>` : html`
    <section id="ready" class="stack">
      <h1>Elige los temas</h1>
      <p class="sum" id="sum"></p>
      <p class="cupo" id="cupo">${textoCarga(carga)}</p>
      <div class="stack" id="grid" role="group" aria-label="Temas">${temasGrid(temas, carga)}</div>
      <div class="legend" aria-hidden="true">
        <span><i class="b-ok"></i>Dominadas</span>
        <span><i class="b-mid"></i>En aprendizaje</span>
        <span><i class="l-new"></i>Nuevas</span>
      </div>
      <div class="examen-row">
        <label class="field"><span>Fecha de examen</span><input type="date" id="cfg-examen" value="${examen?.fecha ?? ""}"></label>
        <span class="hint" id="examen-info">${textoExamen(examen)}</span>
      </div>
      <div class="row">
        <label class="check-inline"><input type="checkbox" id="cfg-un-toque"> Responder al primer toque</label>
        <span class="hint">En móvil, tocar una opción la confirma sin pulsar «Confirmar».</span>
      </div>
      <div class="row">
        <button class="btn primary" type="button" id="btn-start">Empezar <kbd>Enter</kbd></button>
        <button class="btn" type="button" id="btn-all">Todos</button>
        <button class="btn" type="button" id="btn-none">Ninguno</button>
        <span class="spacer"></span>
        <button class="btn danger" type="button" id="btn-clear-prog">Reiniciar progreso</button>
      </div>
    </section>`}
  </main>

  <!-- ============ PANTALLA: test ============ -->
  <main id="screen-quiz" class="stack" hidden>
    <div class="qbar">
      <div class="tags"><span class="tag" id="q-tema"></span><span class="tag" id="q-kind"></span></div>
      <div class="score"><span id="q-score"></span><span id="q-left"></span></div>
    </div>
    <article class="qcard">
      <h2 class="qtext" id="q-text"></h2>
      <div class="opts" id="q-opts" role="radiogroup" aria-labelledby="q-text"></div>
      <div class="fb" id="q-fb" hidden>
        <p class="verdict" id="q-verdict"></p>
        <p class="expl" id="q-expl"></p>
      </div>
    </article>
    <div class="row">
      <button class="btn primary" type="button" id="btn-main"></button>
      <button class="btn" type="button" id="btn-exit">Salir <kbd>Esc</kbd></button>
    </div>
    <p class="keys">
      <span><kbd>↑</kbd><kbd>↓</kbd> elegir</span>
      <span id="keys-opts">Las letras y los números saltan a una opción</span>
      <span><kbd>Enter</kbd> confirmar y continuar</span>
    </p>
    <div class="sr" id="sr" aria-live="polite"></div>
  </main>`;

  return layout({
    titulo: "Test infinito",
    actual: "test",
    estado: "Guardado en la base de datos",
    css: ["test.css"],
    js: vacio ? [] : ["test.js"],
    cuerpo,
  });
}
