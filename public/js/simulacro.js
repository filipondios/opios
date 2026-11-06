/* Simulacro (cliente): configuración, examen cronometrado y revisión final.
   Las preguntas se piden a /api/test y el resultado se guarda en /api/simulacros. */
(() => {
"use strict";

const LETRAS = "ABCDEFGH";
const $ = (s) => document.querySelector(s);

function h(tag, props, ...kids){
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)){
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "open") e.open = !!v;
    else if (k === "checked") e.checked = !!v;
    else if (k === "disabled") e.disabled = !!v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c);
  return e;
}

const msgError = (e) => (e && e.message) ? e.message : String(e);
const setStatus = (kind, text) => { const s = $("#status"); s.dataset.state = kind; s.textContent = text; };
const fmt = (n) => Number(n ?? 0).toLocaleString("es-ES");
const mmss = (segundos) => {
  const s = Math.max(0, Math.round(segundos));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};
const barajar = (a) => {
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
async function api(url, metodo = "GET", cuerpo){
  const opc = { method: metodo, headers: {} };
  if (cuerpo !== undefined){ opc.headers["Content-Type"] = "application/json"; opc.body = JSON.stringify(cuerpo); }
  return fetch(url, opc);
}

let pantalla = "setup";
let preguntas = [], respuestas = [], cur = 0, cursor = 0;
let temas = [], penalizacion = 0, minutos = 60;
let inicio = 0, fin = 0, timer = null, finalizado = false;

/* ---------- Persistencia (localStorage) ---------- */
const CLAVE_CURSO = "opios.simulacro.curso";
const CLAVE_PENDIENTE = "opios.simulacro.pendiente";
const leer = (clave) => { try { return JSON.parse(localStorage.getItem(clave) || "null"); } catch { return null; } };
const escribir = (clave, valor) => { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch {} };
const borrar = (clave) => { try { localStorage.removeItem(clave); } catch {} };
const claveNueva = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));

function guardarCurso(){
  if (pantalla !== "exam" || finalizado) return;
  escribir(CLAVE_CURSO, {
    version: 1, preguntas, respuestas, temas, penalizacion, minutos, cur, inicio, fin,
  });
}

function mostrarReanudar(){
  const curso = leer(CLAVE_CURSO);
  const caja = $("#reanudar");
  if (!caja) return;
  const valido = curso && Array.isArray(curso.preguntas) && curso.preguntas.length
    && Array.isArray(curso.respuestas);
  caja.hidden = !valido;
  if (!valido) return;
  const hechas = curso.respuestas.filter((r) => r != null).length;
  const restante = Number.isFinite(curso.fin)
    ? Math.max(0, Math.round((curso.fin - Date.now()) / 1000))
    : Math.max(0, Number(curso.minutos) || 0) * 60;
  $("#reanudar-info").textContent = `${curso.preguntas.length} preguntas · ${hechas} respondidas · `
    + (restante > 0 ? `quedan ${mmss(restante)}` : "tiempo agotado (se corregirá al reanudar)");
}

function reanudar(){
  const curso = leer(CLAVE_CURSO);
  if (!curso || !Array.isArray(curso.preguntas) || !curso.preguntas.length) return;
  preguntas = curso.preguntas; respuestas = curso.respuestas;
  temas = curso.temas; penalizacion = curso.penalizacion; minutos = curso.minutos;
  cur = curso.cur ?? 0;
  inicio = Number.isFinite(curso.inicio) ? curso.inicio : Date.now();
  fin = Number.isFinite(curso.fin) ? curso.fin : Date.now() + minutos * 60_000;
  finalizado = false; pantalla = "exam";
  $("#screen-setup").hidden = true; $("#screen-results").hidden = true; $("#screen-exam").hidden = false;
  pintarPregunta();
  clearInterval(timer);
  timer = setInterval(actualizarReloj, 1000);
  actualizarReloj();
  setStatus("ok", "Simulacro reanudado");
  window.scrollTo(0, 0);
}

function descartar(){
  if (!window.confirm("¿Descartar el simulacro en curso? Se perderán las respuestas.")) return;
  borrar(CLAVE_CURSO);
  const caja = $("#reanudar");
  if (caja) caja.hidden = true;
}

/* ---------- Configuración ---------- */
const checks = () => [...document.querySelectorAll('input[name="tema"]')];
const marcados = () => checks().filter((c) => c.checked);
const totalDisponible = () => marcados().reduce((s, c) => s + Number(c.dataset.total || 0), 0);

function actualizarResumen(){
  const resumen = $("#cfg-resumen");
  const boton = $("#btn-empezar");
  if (!resumen || !boton) return;
  const n = marcados().length, disp = totalDisponible();
  const pedidas = Math.max(0, Number($("#cfg-n").value) || 0);
  const reales = Math.min(pedidas, disp);
  resumen.textContent = n
    ? `${n} tema(s) seleccionado(s) · ${fmt(disp)} preguntas disponibles · el simulacro tendrá ${fmt(reales)} preguntas.`
    : "Marca al menos un tema para empezar.";
  boton.disabled = !n || !disp;
}

const temasBox = $("#temas");
if (temasBox){
  temasBox.addEventListener("change", actualizarResumen);
  temasBox.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-bloque]");
    if (!b) return;
    const cont = b.closest(".bloque-sel");
    const cs = [...cont.querySelectorAll('input[name="tema"]')];
    const todos = cs.every((c) => c.checked);
    cs.forEach((c) => { c.checked = !todos; });
    actualizarResumen();
  });
}
$("#btn-todos")?.addEventListener("click", () => { checks().forEach((c) => { c.checked = true; }); actualizarResumen(); });
$("#btn-ninguno")?.addEventListener("click", () => { checks().forEach((c) => { c.checked = false; }); actualizarResumen(); });
$("#cfg-n")?.addEventListener("input", actualizarResumen);

/* ---------- Examen ---------- */
function iniciarReloj(min){
  clearInterval(timer);
  fin = Date.now() + min * 60_000;
  actualizarReloj();
  timer = setInterval(actualizarReloj, 1000);
}
function actualizarReloj(){
  const restante = Math.max(0, fin - Date.now());
  const segundos = Math.ceil(restante / 1000);
  const el = $("#exam-timer");
  if (el){ el.textContent = mmss(segundos); el.dataset.low = String(segundos <= 300); }
  if (restante <= 0){ clearInterval(timer); finalizar(true); }
}

async function empezar(){
  if (pantalla !== "setup") return;
  const seleccion = marcados().map((c) => Number(c.value));
  const disponibles = totalDisponible();
  if (!seleccion.length || !disponibles) return;
  const n = Math.min(Math.max(5, Number($("#cfg-n").value) || 50), disponibles);
  const min = Math.min(Math.max(1, Number($("#cfg-min").value) || 60), 300);
  const pen = Number($("#cfg-pen").value) || 0;
  const boton = $("#btn-empezar");
  boton.disabled = true;
  setStatus("busy", "Cargando preguntas…");
  try {
    const r = await api("/api/test?temas=" + seleccion.sort((a, b) => a - b).join(","));
    if (!r.ok) throw new Error("El servidor respondió " + r.status + ".");
    const d = await r.json();
    if (!d.preguntas.length) throw new Error("Los temas elegidos no tienen preguntas.");
    preguntas = barajar(d.preguntas).slice(0, n).map((q) => {
      const orden = barajar(q.respuestas.map((_, k) => k));
      return {
        id: q.id, tema: q.tema, temaNumero: q.tema_numero ?? q.tema,
        bloque: q.bloque_nombre ?? "", temaNombre: q.tema_nombre ?? "",
        pregunta: q.pregunta,
        opciones: orden.map((k) => q.respuestas[k]),
        originales: orden,
        correcta: orden.indexOf(q.correcta),
        explicacion: q.explicacion,
      };
    });
    respuestas = new Array(preguntas.length).fill(null);
    temas = seleccion; penalizacion = pen; minutos = min; cur = 0;
    finalizado = false; inicio = Date.now();
    pantalla = "exam";
    $("#screen-setup").hidden = true; $("#screen-results").hidden = true; $("#screen-exam").hidden = false;
    pintarPregunta();
    iniciarReloj(min);
    setStatus("ok", "Simulacro en curso");
    const caja = $("#reanudar");
    if (caja) caja.hidden = true;
    guardarCurso();
    window.scrollTo(0, 0);
  } catch (e){
    setStatus("warn", "No se pudo empezar: " + msgError(e));
  } finally {
    boton.disabled = false;
  }
}

function pintarPregunta(){
  const q = preguntas[cur];
  if (!q) return;
  cursor = respuestas[cur] ?? 0;
  $("#exam-tema").textContent = etiquetaTema({ tema: q.tema, tema_numero: q.temaNumero, bloque_nombre: q.bloque, nombre: q.temaNombre });
  $("#exam-text").textContent = q.pregunta;
  $("#exam-opts").replaceChildren(...q.opciones.map((texto, k) => h("button", {
    type: "button", class: "opt", "aria-pressed": String(respuestas[cur] === k),
    "data-cursor": k === cursor ? "true" : null,
    onclick: () => elegir(k),
  }, h("span", { class: "bubble", text: LETRAS[k] }), h("span", { class: "otext", text: texto }))));
  $("#exam-progress").textContent = `Pregunta ${cur + 1} de ${preguntas.length}`;
  $("#exam-answered").textContent = `${respuestas.filter((r) => r != null).length} respondidas`;
  $("#btn-prev").disabled = cur === 0;
  $("#btn-next").disabled = cur === preguntas.length - 1;
  pintarPaleta();
}

function pintarCursor(){
  [...document.querySelectorAll("#exam-opts .opt")].forEach((o, i) => {
    if (i === cursor) o.setAttribute("data-cursor", "true");
    else o.removeAttribute("data-cursor");
  });
}

function moverOpcion(d){
  if (pantalla !== "exam" || finalizado) return;
  const n = preguntas[cur]?.opciones.length ?? 0;
  if (!n) return;
  cursor = (cursor + d + n) % n;
  pintarCursor();
}

function elegir(k){
  if (pantalla !== "exam" || finalizado) return;
  cursor = k;
  respuestas[cur] = k;
  [...document.querySelectorAll("#exam-opts .opt")].forEach((o, i) => o.setAttribute("aria-pressed", String(i === k)));
  pintarCursor();
  $("#exam-answered").textContent = `${respuestas.filter((r) => r != null).length} respondidas`;
  pintarPaleta();
  const sr = $("#sr");
  if (sr) sr.textContent = `Opción ${LETRAS[k]} seleccionada.`;
  guardarCurso();
}

function pintarPaleta(){
  const pal = $("#exam-palette");
  if (!pal) return;
  pal.replaceChildren(...preguntas.map((_, i) => h("button", {
    type: "button", class: "pal",
    "data-estado": respuestas[i] != null ? "ok" : "",
    "aria-current": i === cur ? "true" : null,
    "aria-label": `Pregunta ${i + 1}${respuestas[i] != null ? ", respondida" : ""}`,
    onclick: () => irA(i),
  }, String(i + 1))));
}

function irA(i){
  if (pantalla !== "exam" || finalizado) return;
  cur = Math.max(0, Math.min(preguntas.length - 1, i));
  pintarPregunta();
  guardarCurso();
  window.scrollTo(0, 0);
}

function responderYAvanzar(){
  if (!preguntas[cur]) return;
  elegir(cursor);
  if (cur < preguntas.length - 1) irA(cur + 1);
}

function finalizar(forzado = false){
  if (pantalla !== "exam" || finalizado) return;
  const blancos = respuestas.filter((r) => r == null).length;
  if (!forzado && blancos > 0 && !window.confirm(`Quedan ${blancos} pregunta(s) sin responder. ¿Finalizar igualmente?`)) return;
  finalizado = true;
  clearInterval(timer);
  borrar(CLAVE_CURSO);
  const segundos = Math.min(Math.round((Date.now() - inicio) / 1000), minutos * 60);
  const res = calcularResultado(preguntas, respuestas, penalizacion, segundos);
  pantalla = "results";
  $("#screen-exam").hidden = true; $("#screen-results").hidden = false;
  pintarResultado(res);
  setStatus("busy", "Guardando resultado…");
  guardarResultado(res);
  window.scrollTo(0, 0);
}

function salir(){
  if (pantalla !== "exam") return;
  if (!window.confirm("¿Salir del simulacro? Podrás reanudarlo desde esta página.")) return;
  clearInterval(timer);
  pantalla = "setup";
  $("#screen-exam").hidden = true; $("#screen-setup").hidden = false;
  setStatus("ok", "Simulacro en pausa");
  mostrarReanudar();
  actualizarResumen();
  window.scrollTo(0, 0);
}

const ETIQUETAS_PEN = new Map([
  [0, "sin penalización"],
  [0.25, "1/4 por fallo"],
  [1 / 3, "1/3 por fallo"],
  [0.5, "1/2 por fallo"],
]);
const textoPenalizacion = (p) => ETIQUETAS_PEN.get(p)
  ?? `${p.toLocaleString("es-ES", { maximumFractionDigits: 3 })} por fallo`;

/* ---------- Resultado ---------- */
function kpi(valor, etiqueta){
  return h("div", { class: "kpi" },
    h("span", { class: "kpi-n", text: valor }),
    h("span", { class: "kpi-l", text: etiqueta }));
}

function pintarResultado(res){
  const pen = textoPenalizacion(penalizacion);
  $("#res-sub").textContent = `${res.total} preguntas · ${minutos} min · ${pen}`;
  $("#res-kpis").replaceChildren(
    kpi(res.puntos.toFixed(2), "puntos"),
    kpi(res.nota.toFixed(2) + " / 10", "nota"),
    kpi(String(res.aciertos), "aciertos"),
    kpi(String(res.fallos), "fallos"),
    kpi(String(res.blancos), "en blanco"),
    kpi(mmss(res.segundos), "tiempo"),
  );

  const tabla = $("#res-temas");
  tabla.replaceChildren(
    h("thead", null, h("tr", null, ["Tema", "Preguntas", "Aciertos", "Fallos", "Blancos", "Precisión"]
      .map((x) => h("th", { text: x })))),
    h("tbody", null, res.porTema.map((t) => h("tr", null,
      h("td", null, h("b", { text: etiquetaTema({ tema: t.tema, tema_numero: t.numero, bloque_nombre: t.bloque, nombre: t.nombre }) })),
      h("td", { text: String(t.total) }),
      h("td", { text: String(t.aciertos) }),
      h("td", { text: String(t.fallos) }),
      h("td", { text: String(t.blancos) }),
      h("td", { text: (t.aciertos + t.fallos) ? Math.round((t.aciertos / (t.aciertos + t.fallos)) * 100) + " %" : "—" }),
    ))),
  );

  $("#res-revision").replaceChildren(...preguntas.map((q, i) => itemRevision(q, i)));
  aplicarFiltroRevision();
}

function itemRevision(q, i){
  const r = respuestas[i];
  const estado = r == null ? "blanco" : r === q.correcta ? "acierto" : "fallo";
  const etiqueta = estado === "acierto" ? "Correcta" : estado === "fallo" ? "Fallada" : "En blanco";
  return h("details", { class: "review", open: estado !== "acierto", "data-estado": estado },
    h("summary", null,
      h("span", { class: "review-num", text: String(i + 1) }),
      h("span", { class: "review-estado " + estado, text: etiqueta }),
      h("span", { class: "review-preg", text: q.pregunta })),
    h("div", { class: "review-body" },
      h("p", { class: "review-meta", text: etiquetaTema({ tema: q.tema, tema_numero: q.temaNumero, bloque_nombre: q.bloque, nombre: q.temaNombre }) }),
      h("ul", { class: "review-opts" }, q.opciones.map((texto, k) => {
        const clases = ["review-opt"];
        if (k === q.correcta) clases.push("ok");
        if (r === k && r !== q.correcta) clases.push("bad");
        return h("li", { class: clases.join(" ") },
          h("b", { text: LETRAS[k] + ") " }),
          texto,
          k === q.correcta ? h("span", { class: "review-tag", text: " correcta" }) : null);
      })),
      q.explicacion ? h("p", { class: "expl", text: q.explicacion }) : null,
    ));
}

function aplicarFiltroRevision(){
  const soloFallos = $("#res-solo-fallos")?.checked ?? true;
  [...document.querySelectorAll("#res-revision .review")].forEach((el) => {
    el.hidden = soloFallos && el.dataset.estado === "acierto";
  });
}

function cuerpoSimulacro(res){
  return {
    temas,
    segundos: res.segundos,
    penalizacion,
    respuestas: preguntas.map((q, i) => ({
      id: q.id,
      elegida: respuestas[i] == null ? -1 : q.originales[respuestas[i]],
    })),
  };
}

const pendientes = () => {
  const lista = leer(CLAVE_PENDIENTE);
  return Array.isArray(lista) ? lista : [];
};
let enviando = false;

/** Envía los resultados pendientes. Si falla, se quedan guardados para el próximo intento. */
async function enviarPendientes(){
  if (enviando) return;
  if (!pendientes().length) return;
  enviando = true;
  let fallos = 0;
  try {
    while (true){
      const item = pendientes()[0];
      if (!item) break;
      try {
        const r = await api("/api/simulacros", "POST", item.cuerpo);
        if (!r.ok){
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || ("El servidor respondió " + r.status + "."));
        }
        await r.json();
        escribir(CLAVE_PENDIENTE, pendientes().filter((x) => x.clave !== item.clave));
      } catch (e){
        fallos++;
        console.warn("Simulacro pendiente: " + msgError(e));
        break; // se reintenta en la próxima visita
      }
    }
  } finally {
    enviando = false;
  }
  setStatus(fallos ? "warn" : "ok",
    fallos ? "No se pudo guardar el resultado; se reintentará al volver a esta página."
      : "Resultado guardado");
}

function guardarResultado(res){
  const clave = claveNueva();
  const cuerpo = { ...cuerpoSimulacro(res), clave_idempotencia: clave };
  escribir(CLAVE_PENDIENTE, [...pendientes(), { clave, cuerpo }]);
  return enviarPendientes();
}

function repetir(){
  clearInterval(timer);
  pantalla = "setup";
  preguntas = []; respuestas = []; cur = 0;
  $("#screen-results").hidden = true; $("#screen-exam").hidden = true; $("#screen-setup").hidden = false;
  setStatus("ok", "Guardado en la base de datos");
  mostrarReanudar();
  actualizarResumen();
  window.scrollTo(0, 0);
}

/* ---------- Eventos ---------- */
$("#btn-empezar")?.addEventListener("click", empezar);
$("#btn-reanudar")?.addEventListener("click", reanudar);
$("#btn-descartar")?.addEventListener("click", descartar);
$("#btn-prev")?.addEventListener("click", () => irA(cur - 1));
$("#btn-next")?.addEventListener("click", () => irA(cur + 1));
$("#btn-finish")?.addEventListener("click", () => finalizar(false));
$("#btn-salir")?.addEventListener("click", salir);
$("#btn-repetir")?.addEventListener("click", repetir);
$("#res-solo-fallos")?.addEventListener("change", aplicarFiltroRevision);

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (pantalla !== "exam" || finalizado) return;
  const tag = (e.target && e.target.tagName || "").toLowerCase();
  if (["input", "select", "textarea"].includes(tag)) return;
  const k = e.key;
  if (k === "Escape"){ e.preventDefault(); salir(); return; }
  if (k === "ArrowUp"){ e.preventDefault(); moverOpcion(-1); return; }
  if (k === "ArrowDown"){ e.preventDefault(); moverOpcion(1); return; }
  if (k === "ArrowLeft"){ e.preventDefault(); irA(cur - 1); return; }
  if (k === "ArrowRight"){ e.preventDefault(); irA(cur + 1); return; }
  if (k === "Enter"){
    const enOpcion = e.target && e.target.closest && e.target.closest("#exam-opts .opt");
    if (tag === "button" && !enOpcion) return;
    e.preventDefault();
    responderYAvanzar();
    return;
  }
});

async function arrancar(){
  await enviarPendientes();
  mostrarReanudar();
  actualizarResumen();
}
arrancar();
})();
