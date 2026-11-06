import { Sesion } from "./repaso.js";

/* Test infinito (cliente): UI del test. El planificador vive en ./repaso.js.
   Los datos viven en el servidor (SQLite): preguntas por /api/test y progreso por /api/progreso. */
(() => {
"use strict";

/* ---------- Parámetros de la UI ---------- */
const PAUSA_ACIERTO_MS  = 450;     // pausa tras un acierto antes de pasar a la siguiente
const ETIQUETA          = "Guardado en la base de datos";
const LETRAS = "ABCDEFGH";

/* ---------- Utilidades ---------- */
const $ = (s) => document.querySelector(s);
function h(tag, props, ...kids){
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)){
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
function barajar(a){ a = a.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
const msgError = (e) => (e && e.message) ? e.message : String(e);

/* ---------- API ---------- */
async function api(url, opciones){
  const r = await fetch(url, opciones);
  if (!r.ok){
    let m = "El servidor respondió " + r.status + ".";
    try { const d = await r.json(); if (d && d.error) m = d.error; } catch (e) {}
    throw new Error(m);
  }
  return r;
}
const JSON_HEAD = { "Content-Type": "application/json" };

/* ---------- Estado ---------- */
let bank = [];          // preguntas de la sesión: {i,t,p,o,c,e}
let progress = {};      // id -> [caja, vence, aciertos, fallos]
let seleccion = new Set();
let pantalla = "setup";
let sesion = null;
let cur = null;         // pregunta en pantalla
let timerAcierto = null;
let sucios = new Set();
let timerGuardado = null;
let carga = null;            // cupo diario que devuelve el servidor
let examenInfo = null;       // fecha de examen y tope de intervalo (Fase 3.6)
let respuestasCola = [];     // respuestas pendientes de enviar a /api/respuestas
let timerRespuestas = null;

function setStatus(kind, text){ const s = $("#status"); s.dataset.state = kind; s.textContent = text; }
function nota(texto, lineas){
  const n = $("#note");
  if (!texto){ n.hidden = true; n.replaceChildren(); return; }
  const partes = [h("span", { text: texto })];
  if (lineas && lineas.length) partes.push(h("ul", null, lineas.map((l) => h("li", { text: l }))));
  n.replaceChildren(...partes);
  n.hidden = false;
}

/* ---------- Progreso: guardado diferido por lotes ---------- */
function marcarSucio(id){
  sucios.add(id);
  clearTimeout(timerGuardado);
  timerGuardado = setTimeout(guardarProgreso, 700);
}
async function guardarProgreso(){
  clearTimeout(timerGuardado);
  if (!sucios.size) return;
  const ids = [...sucios]; sucios.clear();
  setStatus("busy", "Guardando…");
  try {
    await api("/api/progreso", {
      method: "POST", headers: JSON_HEAD, keepalive: true,
      body: JSON.stringify(ids.map((id) => { const p = progress[id]; return { id, caja: p[0], vence: p[1], aciertos: p[2], fallos: p[3] }; })),
    });
    setStatus("ok", ETIQUETA);
  } catch (e) { ids.forEach((id) => sucios.add(id)); setStatus("warn", "No se pudo guardar: " + msgError(e)); }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden"){ guardarProgreso(); guardarRespuestas(); } });
window.addEventListener("pagehide", () => { guardarProgreso(); guardarRespuestas(); });

/* ---------- Respuestas: un evento por pregunta, para las estadísticas y el cupo diario ---------- */
function encolarRespuesta(id, acierto, ms){
  respuestasCola.push({ id, acierto, ms });
  clearTimeout(timerRespuestas);
  timerRespuestas = setTimeout(guardarRespuestas, 700);
}
async function guardarRespuestas(){
  clearTimeout(timerRespuestas);
  if (!respuestasCola.length) return;
  const lote = respuestasCola; respuestasCola = [];
  try {
    await api("/api/respuestas", {
      method: "POST", headers: JSON_HEAD, keepalive: true,
      body: JSON.stringify({ respuestas: lote }),
    });
  } catch (e) {
    respuestasCola = lote.concat(respuestasCola);
    setStatus("warn", "No se pudieron guardar las respuestas: " + msgError(e));
  }
}

/* ---------- Cupo diario (lo calcula el servidor; aquí solo se muestra) ---------- */
function leerCarga(){
  const el = document.querySelector("#grid .carga");
  if (!el){ return; }
  carga = {
    nuevasHoy: Number(el.dataset.nuevasHoy || 0),
    cupoNuevas: Number(el.dataset.cupoNuevas || 0),
    repasosPendientes: Number(el.dataset.repasos || 0),
    repasosAtrasados: Number(el.dataset.atrasados || 0),
    bloqueadoPorAtraso: el.dataset.bloqueado === "1",
  };
}
function pintarCarga(){
  const el = $("#cupo"); if (!el) return;
  if (!carga){ el.textContent = ""; return; }
  const restantes = Math.max(0, carga.cupoNuevas - carga.nuevasHoy);
  const partes = ["Nuevas hoy: " + carga.nuevasHoy + "/" + carga.cupoNuevas];
  if (carga.repasosPendientes) partes.push(carga.repasosPendientes + " por repasar");
  if (carga.bloqueadoPorAtraso) partes.push("frenado: " + carga.repasosAtrasados + " repasos atrasados");
  else if (restantes === 0) partes.push("cupo de nuevas agotado hoy");
  el.textContent = partes.join(" · ");
}
/** Nuevas que aún se pueden introducir en esta sesión, según el cupo del servidor. */
function nuevasPermitidas(){
  if (!carga) return Infinity;
  if (carga.bloqueadoPorAtraso) return 0;
  return Math.max(0, carga.cupoNuevas - carga.nuevasHoy);
}

/* ---------- Pantalla de preparación (la rejilla llega ya pintada desde el servidor) ---------- */
const chips = () => [...document.querySelectorAll("#grid .chip")];
function guardarSeleccion(){ try { localStorage.setItem("ti.sel", JSON.stringify([...seleccion])); } catch (e) {} }
function leerSeleccion(){ try { const v = JSON.parse(localStorage.getItem("ti.sel")); return Array.isArray(v) ? v : null; } catch (e) { return null; } }

/* Refleja `seleccion` en las fichas y actualiza el resumen. Si no queda ningún tema válido, marca todos. */
function sincronizarSeleccion(previa){
  const existentes = new Set(chips().map((c) => Number(c.dataset.tema)));
  seleccion = new Set([...(previa || seleccion)].filter((t) => existentes.has(t)));
  if (!seleccion.size) seleccion = new Set(existentes);
  chips().forEach((c) => c.setAttribute("aria-checked", String(seleccion.has(Number(c.dataset.tema)))));
  actualizarResumen();
}
function fijarSeleccion(todos){
  seleccion = todos ? new Set(chips().map((c) => Number(c.dataset.tema))) : new Set();
  chips().forEach((c) => c.setAttribute("aria-checked", String(todos)));
  actualizarResumen(); guardarSeleccion();
}
function actualizarResumen(){
  let total = 0, nuevas = 0, repaso = 0;
  for (const c of chips()) if (seleccion.has(Number(c.dataset.tema))){
    total += Number(c.dataset.total); nuevas += Number(c.dataset.nuevas); repaso += Number(c.dataset.repaso);
  }
  const sum = $("#sum");
  sum.replaceChildren();
  if (!seleccion.size){ sum.textContent = "Marca al menos un tema para empezar."; }
  else sum.append(h("b", { text: String(total) }), " preguntas · ", h("b", { text: String(repaso) }), " por repasar hoy · ", h("b", { text: String(nuevas) }), " nuevas");
  $("#btn-start").disabled = !seleccion.size;
}
/* Pide al servidor la rejilla actualizada (estadísticas tras una sesión o un reinicio). */
async function refrescarTemas(){
  try {
    $("#grid").innerHTML = await (await api("/fragmentos/temas")).text();
    leerCarga();
    sincronizarSeleccion();
    pintarCarga();
  } catch (e) { setStatus("warn", "No se pudieron actualizar los temas: " + msgError(e)); }
}

$("#grid").addEventListener("mousedown", (e) => { if (e.target.closest(".chip")) e.preventDefault(); });
$("#grid").addEventListener("click", (e) => {
  const c = e.target.closest(".chip"); if (!c) return;
  const t = Number(c.dataset.tema);
  if (seleccion.has(t)) seleccion.delete(t); else seleccion.add(t);
  c.setAttribute("aria-checked", String(seleccion.has(t)));
  actualizarResumen(); guardarSeleccion();
});
/* Selecciona (o deselecciona) todos los temas de un bloque. */
$("#grid").addEventListener("click", (e) => {
  const b = e.target.closest(".sel-bloque"); if (!b) return;
  const cs = [...b.closest(".bloque").querySelectorAll(".chip")];
  const temas = cs.map((c) => Number(c.dataset.tema));
  const todos = temas.every((t) => seleccion.has(t));
  for (const t of temas) { if (todos) seleccion.delete(t); else seleccion.add(t); }
  cs.forEach((c) => c.setAttribute("aria-checked", String(seleccion.has(Number(c.dataset.tema)))));
  actualizarResumen(); guardarSeleccion();
});

/* ---------- Borrados con doble pulsación ---------- */
function conConfirmacion(btn, texto, accion){
  const original = btn.textContent; let t = null;
  btn.addEventListener("click", async () => {
    if (!btn.classList.contains("armed")){
      btn.classList.add("armed"); btn.textContent = "¿Seguro? Pulsa otra vez";
      t = setTimeout(() => { btn.classList.remove("armed"); btn.textContent = original; }, 4000);
      return;
    }
    clearTimeout(t); btn.classList.remove("armed"); btn.textContent = original;
    try { await accion(); nota(texto); } catch (e) { setStatus("warn", "No se pudo completar: " + msgError(e)); }
  });
}
conConfirmacion($("#btn-clear-prog"), "Progreso reiniciado: todas las preguntas vuelven a ser nuevas.", async () => {
  clearTimeout(timerGuardado); sucios.clear();
  clearTimeout(timerRespuestas); respuestasCola = [];
  await api("/api/progreso", { method: "DELETE" });
  progress = {};
  await refrescarTemas();
});
$("#btn-all").addEventListener("click", () => fijarSeleccion(true));
$("#btn-none").addEventListener("click", () => fijarSeleccion(false));
$("#btn-start").addEventListener("click", empezar);

/* ---------- Fecha de examen (Fase 3.6): acorta los intervalos de repaso ---------- */
function pintarExamen(){
  const el = $("#examen-info"); if (!el) return;
  const ex = examenInfo;
  if (!ex || !ex.fecha){ el.textContent = ""; return; }
  el.textContent = ex.dias > 0
    ? `${ex.dias} día${ex.dias === 1 ? "" : "s"} hasta el examen · los repasos se acortan a ${ex.topeDias} día${ex.topeDias === 1 ? "" : "s"}`
    : "La fecha de examen ya ha pasado.";
}
async function guardarExamen(){
  const input = $("#cfg-examen"); if (!input) return;
  setStatus("busy", "Guardando...");
  try {
    const d = await (await api("/api/ajustes", { method: "PUT", headers: JSON_HEAD, body: JSON.stringify({ fecha_examen: input.value || null }) })).json();
    examenInfo = d.examen; pintarExamen(); setStatus("ok", ETIQUETA);
  } catch (e) { setStatus("warn", "No se pudo guardar la fecha: " + msgError(e)); }
}
$("#cfg-examen")?.addEventListener("change", guardarExamen);

/* ---------- Test ---------- */
const ICO_OK  = '<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 11.5l4.5 4.5 8.5-9.5"/></svg>';
const ICO_BAD = '<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5.5 5.5l11 11M16.5 5.5l-11 11"/></svg>';

async function empezar(){
  if (!seleccion.size || pantalla !== "setup") return;
  const boton = $("#btn-start"); boton.disabled = true;
  setStatus("busy", "Cargando preguntas…");
  try {
    await guardarProgreso();
    await guardarRespuestas();
    const d = await (await api("/api/test?temas=" + [...seleccion].sort((a, b) => a - b).join(","))).json();
    bank = d.preguntas.map((q) => ({
      i: q.id, t: q.tema, tn: q.tema_numero ?? q.tema, bn: q.bloque_nombre ?? "", nb: q.tema_nombre ?? "",
      p: q.pregunta, o: q.respuestas, c: q.correcta, e: q.explicacion,
    }));
    progress = d.progreso;
    if (d.carga) carga = d.carga;
    if (d.examen) { examenInfo = d.examen; pintarExamen(); }
    if (!bank.length) throw new Error("Los temas elegidos no tienen preguntas.");
  } catch (e) {
    setStatus("warn", "No se pudieron cargar las preguntas: " + msgError(e)); boton.disabled = false; return;
  }
  setStatus("ok", ETIQUETA); boton.disabled = false;
  nota(null);
  pintarCarga();
  sesion = new Sesion(bank, { progreso: progress, alCambiar: marcarSucio, nuevasPermitidas: nuevasPermitidas(), topeIntervalo: examenInfo?.topeDias ?? 0 });
  pantalla = "quiz";
  $("#screen-setup").hidden = true; $("#screen-quiz").hidden = false;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  preguntar();
}
function preguntar(){
  clearTimeout(timerAcierto);
  const [q, tipo] = sesion.siguiente();
  const orden = barajar(q.o.map((_, k) => k));
  cur = { q, tipo, orden, sel: 0, corr: orden.indexOf(q.c), fase: "elegir", t0: Date.now() };
  $("#q-tema").textContent = etiquetaTema({ tema: q.t, tema_numero: q.tn, bloque_nombre: q.bn, nombre: q.nb });
  const kind = $("#q-kind"); kind.textContent = tipo; kind.dataset.kind = tipo;
  $("#q-text").textContent = q.p;
  $("#q-opts").replaceChildren(...orden.map((oi, k) =>
    h("div", { class: "opt", role: "radio", "aria-checked": "false", onclick: () => clicOpcion(k) },
      h("span", { class: "bubble", text: LETRAS[k] }),
      h("span", { class: "otext", text: q.o[oi] }),
      h("span", { class: "mark", "aria-hidden": "true" }))));
  $("#q-fb").hidden = true;
  pintarSeleccion(); pintarMarcador(); botonPrincipal();
  window.scrollTo(0, 0);
}
function opciones(){ return [...document.querySelectorAll("#q-opts .opt")]; }
function pintarSeleccion(){ opciones().forEach((o, k) => o.setAttribute("aria-checked", String(k === cur.sel && cur.fase === "elegir"))); }
function pintarMarcador(){
  $("#q-score").textContent = sesion.aciertos + " de " + sesion.n + " acertadas";
  const { rep, nue } = sesion.pendientes();
  $("#q-left").textContent = "por repasar " + rep + " · nuevas " + nue;
}
function botonPrincipal(){
  const b = $("#btn-main");
  b.replaceChildren(cur.fase === "elegir" ? "Confirmar " : "Continuar ", h("kbd", { text: "Enter" }));
}
function mover(d){ const n = cur.orden.length; cur.sel = (cur.sel + d + n) % n; pintarSeleccion(); }
function seleccionar(k){ cur.sel = k; pintarSeleccion(); }
function clicOpcion(k){ if (cur.fase !== "elegir") return; if (cur.sel === k) confirmar(); else seleccionar(k); }

function confirmar(){
  if (!cur || cur.fase !== "elegir") return;
  const ok = cur.sel === cur.corr;
  sesion.registrar(cur.q, ok);
  encolarRespuesta(cur.q.i, ok, Math.max(0, Date.now() - cur.t0));
  const ops = opciones();
  ops.forEach((o) => o.setAttribute("aria-checked", "false"));
  ops[cur.corr].classList.add("ok"); ops[cur.corr].querySelector(".mark").innerHTML = ICO_OK;
  const letra = LETRAS[cur.corr];
  if (ok){
    cur.fase = "acierto";
    $("#sr").textContent = "Correcto.";
    timerAcierto = setTimeout(preguntar, PAUSA_ACIERTO_MS);
  } else {
    cur.fase = "revision";
    ops[cur.sel].classList.add("bad"); ops[cur.sel].querySelector(".mark").innerHTML = ICO_BAD;
    ops.forEach((o, k) => { if (k !== cur.sel && k !== cur.corr) o.classList.add("dim"); });
    $("#q-verdict").textContent = "Incorrecta. La respuesta correcta es la " + letra + ".";
    const ex = $("#q-expl"); ex.textContent = cur.q.e; ex.hidden = !cur.q.e;
    $("#q-fb").hidden = false;
    $("#sr").textContent = "Incorrecta. La respuesta correcta es la " + letra + ". " + cur.q.e;
    $("#q-fb").scrollIntoView({ block: "nearest" });
  }
  pintarMarcador(); botonPrincipal();
}
function avanzar(){ if (cur && cur.fase !== "elegir") preguntar(); }
$("#btn-main").addEventListener("click", () => { if (cur.fase === "elegir") confirmar(); else avanzar(); });
$("#btn-exit").addEventListener("click", salir);

async function salir(){
  if (pantalla !== "quiz") return;
  clearTimeout(timerAcierto);
  const { aciertos, n } = sesion;
  pantalla = "setup"; cur = null;
  $("#screen-quiz").hidden = true; $("#screen-setup").hidden = false;
  nota(n ? "Sesión terminada: " + aciertos + " de " + n + " acertadas (" + Math.round(100 * aciertos / n) + " %)." : null);
  window.scrollTo(0, 0);
  await guardarProgreso();
  await guardarRespuestas();
  await refrescarTemas();
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (pantalla === "quiz" && cur){
    const k = e.key;
    if (k === "Escape"){ e.preventDefault(); salir(); return; }
    if (k === "Enter"){ e.preventDefault(); if (e.repeat) return; if (cur.fase === "elegir") confirmar(); else avanzar(); return; }
    if (cur.fase !== "elegir") return;
    if (k === "ArrowDown" || k === "ArrowUp"){ e.preventDefault(); mover(k === "ArrowDown" ? 1 : -1); return; }
    let n = -1;
    if (/^[1-9]$/.test(k)) n = Number(k) - 1;
    else if (/^[a-hA-H]$/.test(k)) n = k.toLowerCase().charCodeAt(0) - 97;
    if (n >= 0 && n < cur.orden.length){ e.preventDefault(); seleccionar(n); }
    return;
  }
  if (pantalla === "setup" && e.key === "Enter" && !e.repeat && (e.target === document.body || e.target === document.documentElement || e.target === document)){
    if (!$("#ready").hidden && !$("#btn-start").disabled){ e.preventDefault(); empezar(); }
  }
});

/* ---------- Arranque ---------- */
sincronizarSeleccion(leerSeleccion() || []);
leerCarga();
pintarCarga();
setStatus("ok", ETIQUETA);

})();
