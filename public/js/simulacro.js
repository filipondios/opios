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
let preguntas = [], respuestas = [], cur = 0;
let temas = [], penalizacion = 0, minutos = 60;
let inicio = 0, fin = 0, timer = null, finalizado = false;

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
        bloque: q.bloque_nombre ?? "", pregunta: q.pregunta,
        opciones: orden.map((k) => q.respuestas[k]),
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
  $("#exam-tema").textContent = (q.bloque ? q.bloque + " · " : "") + "Tema " + q.temaNumero;
  $("#exam-text").textContent = q.pregunta;
  $("#exam-opts").replaceChildren(...q.opciones.map((texto, k) => h("button", {
    type: "button", class: "opt", "aria-pressed": String(respuestas[cur] === k),
    onclick: () => elegir(k),
  }, h("span", { class: "bubble", text: LETRAS[k] }), h("span", { class: "otext", text: texto }))));
  $("#exam-progress").textContent = `Pregunta ${cur + 1} de ${preguntas.length}`;
  $("#exam-answered").textContent = `${respuestas.filter((r) => r != null).length} respondidas`;
  $("#btn-prev").disabled = cur === 0;
  $("#btn-next").disabled = cur === preguntas.length - 1;
  pintarPaleta();
}

function elegir(k){
  if (pantalla !== "exam" || finalizado) return;
  respuestas[cur] = k;
  [...document.querySelectorAll("#exam-opts .opt")].forEach((o, i) => o.setAttribute("aria-pressed", String(i === k)));
  $("#exam-answered").textContent = `${respuestas.filter((r) => r != null).length} respondidas`;
  pintarPaleta();
  const sr = $("#sr");
  if (sr) sr.textContent = `Opción ${LETRAS[k]} seleccionada.`;
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
  window.scrollTo(0, 0);
}

function finalizar(forzado = false){
  if (pantalla !== "exam" || finalizado) return;
  const blancos = respuestas.filter((r) => r == null).length;
  if (!forzado && blancos > 0 && !window.confirm(`Quedan ${blancos} pregunta(s) sin responder. ¿Finalizar igualmente?`)) return;
  finalizado = true;
  clearInterval(timer);
  const segundos = Math.min(Math.round((Date.now() - inicio) / 1000), minutos * 60);
  const res = calcularResultado(segundos);
  pantalla = "results";
  $("#screen-exam").hidden = true; $("#screen-results").hidden = false;
  pintarResultado(res);
  setStatus("busy", "Guardando resultado…");
  guardarResultado(res);
  window.scrollTo(0, 0);
}

function salir(){
  if (pantalla !== "exam") return;
  if (!window.confirm("¿Salir del simulacro? Las respuestas no se guardarán.")) return;
  clearInterval(timer);
  pantalla = "setup";
  $("#screen-exam").hidden = true; $("#screen-setup").hidden = false;
  setStatus("ok", "Guardado en la base de datos");
  actualizarResumen();
  window.scrollTo(0, 0);
}

/* ---------- Resultado ---------- */
function calcularResultado(segundos){
  let aciertos = 0, fallos = 0, blancos = 0;
  const porTema = new Map();
  preguntas.forEach((q, i) => {
    const r = respuestas[i];
    let estado;
    if (r == null){ blancos++; estado = "blanco"; }
    else if (r === q.correcta){ aciertos++; estado = "acierto"; }
    else { fallos++; estado = "fallo"; }
    const t = porTema.get(q.temaNumero) ?? { tema: q.temaNumero, total: 0, aciertos: 0, fallos: 0, blancos: 0 };
    t.total++;
    t[estado === "acierto" ? "aciertos" : estado === "fallo" ? "fallos" : "blancos"]++;
    porTema.set(q.temaNumero, t);
  });
  const total = preguntas.length;
  const puntos = Math.round((aciertos - fallos * penalizacion) * 100) / 100;
  const nota = total ? Math.round((puntos / total) * 1000) / 100 : 0;
  return {
    total, aciertos, fallos, blancos, puntos, nota, segundos,
    porTema: [...porTema.values()].sort((a, b) => a.tema - b.tema),
  };
}

function kpi(valor, etiqueta){
  return h("div", { class: "kpi" },
    h("span", { class: "kpi-n", text: valor }),
    h("span", { class: "kpi-l", text: etiqueta }));
}

function pintarResultado(res){
  const pen = penalizacion === 0
    ? "sin penalización"
    : `${penalizacion.toLocaleString("es-ES", { maximumFractionDigits: 3 })} por fallo`;
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
      h("td", null, h("b", { text: "Tema " + t.tema })),
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
      h("p", { class: "review-meta", text: `Tema ${q.temaNumero}${q.bloque ? " · " + q.bloque : ""}` }),
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

async function guardarResultado(res){
  try {
    const r = await api("/api/simulacros", "POST", {
      temas,
      segundos: res.segundos,
      penalizacion,
      respuestas: preguntas.map((q, i) => ({ id: q.id, elegida: respuestas[i] == null ? -1 : respuestas[i] })),
    });
    if (!r.ok){
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || ("El servidor respondió " + r.status + "."));
    }
    await r.json();
    setStatus("ok", "Resultado guardado");
  } catch (e){
    setStatus("warn", "No se pudo guardar el resultado: " + msgError(e));
  }
}

function repetir(){
  clearInterval(timer);
  pantalla = "setup";
  preguntas = []; respuestas = []; cur = 0;
  $("#screen-results").hidden = true; $("#screen-exam").hidden = true; $("#screen-setup").hidden = false;
  setStatus("ok", "Guardado en la base de datos");
  actualizarResumen();
  window.scrollTo(0, 0);
}

/* ---------- Eventos ---------- */
$("#btn-empezar")?.addEventListener("click", empezar);
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
  if (k === "ArrowLeft"){ e.preventDefault(); irA(cur - 1); return; }
  if (k === "ArrowRight"){ e.preventDefault(); irA(cur + 1); return; }
  if (k === "Enter"){
    if (tag === "button") return;
    e.preventDefault();
    if (cur === preguntas.length - 1) finalizar(false); else irA(cur + 1);
    return;
  }
  let n = -1;
  if (/^[1-9]$/.test(k)) n = Number(k) - 1;
  else if (/^[a-hA-H]$/.test(k)) n = k.toLowerCase().charCodeAt(0) - 97;
  if (n >= 0 && n < preguntas[cur].opciones.length){ e.preventDefault(); elegir(n); }
});

actualizarResumen();
})();
