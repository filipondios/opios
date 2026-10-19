/* Test infinito (cliente): planificador de repasos y UI del test.
   Los datos viven en el servidor (SQLite): preguntas por /api/test y progreso por /api/progreso. */
(() => {
"use strict";

/* ---------- Parámetros del repaso (ajústalos a tu gusto) ---------- */
const INTERVALOS_DIAS   = [0, 1, 3, 7, 16, 35, 90]; // días hasta el siguiente repaso según la caja (7 cajas: 0..6)
const PASOS_APRENDIZAJE = [3, 8];  // tras fallar: reaparece tras 3 preguntas, luego tras 8
const PROB_REPASO       = 0.6;     // si hay repasos y nuevas a la vez, probabilidad de sacar un repaso
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
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
const hoy = () => iso(new Date());
const masDias = (n) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+n); return iso(d); };
const elegir = (a) => a[Math.floor(Math.random()*a.length)];
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
const sucios = new Set();
let timerGuardado = null;

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
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") guardarProgreso(); });
window.addEventListener("pagehide", () => { guardarProgreso(); });

/* ---------- Planificador de repasos ---------- */
class Sesion {
  constructor(pool){
    this.pool = pool;
    this.porId = new Map(pool.map((q) => [q.i, q]));
    this.n = 0; this.aprendizaje = new Map(); this.ultima = null;
    this.aciertos = 0; this.fallos = 0;
  }
  siguiente(){
    const hoyIso = hoy();
    // 1) preguntas falladas cuyo turno ya llegó
    let mejor = null;
    for (const [id, [, v]] of this.aprendizaje) if (v <= this.n && (!mejor || v < mejor.v)) mejor = { id, v };
    if (mejor) return [this.porId.get(mejor.id), "Reintento"];
    // 2) repasos vencidos y 3) nuevas
    const repasos = [], nuevas = [];
    for (const q of this.pool){
      const p = progress[q.i];
      if (!p) nuevas.push(q);
      else if (!this.aprendizaje.has(q.i) && p[1] <= hoyIso) repasos.push(q);
    }
    if (repasos.length && (!nuevas.length || Math.random() < PROB_REPASO)){
      const menor = repasos.reduce((m, q) => progress[q.i][1] < m ? progress[q.i][1] : m, "9999-99-99");
      return [elegir(repasos.filter((q) => progress[q.i][1] === menor)), "Repaso"];
    }
    if (nuevas.length) return [elegir(nuevas), "Nueva"];
    // 4) nada pendiente salvo reintentos que aún no tocan
    if (this.aprendizaje.size){
      let m = null; for (const [id, [, v]] of this.aprendizaje) if (!m || v < m.v) m = { id, v };
      return [this.porId.get(m.id), "Reintento"];
    }
    // 5) modo libre infinito: más peso a las cajas bajas y a las más falladas
    let cand = this.pool.filter((q) => q.i !== this.ultima); if (!cand.length) cand = this.pool;
    const pesos = cand.map((q) => { const p = progress[q.i]; return 1/(p[0]+1) + 0.3*p[3]/Math.max(1, p[2]+p[3]); });
    let r = Math.random() * pesos.reduce((a, b) => a + b, 0);
    for (let k = 0; k < cand.length; k++){ r -= pesos[k]; if (r <= 0) return [cand[k], "Práctica libre"]; }
    return [cand[cand.length-1], "Práctica libre"];
  }
  registrar(q, acierto){
    const id = q.i, existia = !!progress[id];
    const p = progress[id] || (progress[id] = [0, hoy(), 0, 0]);
    this.n++; this.ultima = id;
    if (acierto){
      this.aciertos++; p[2]++;
      if (this.aprendizaje.has(id)){
        const paso = this.aprendizaje.get(id)[0] + 1;
        if (paso >= PASOS_APRENDIZAJE.length){ this.aprendizaje.delete(id); p[0] = 1; p[1] = masDias(INTERVALOS_DIAS[1]); }
        else this.aprendizaje.set(id, [paso, this.n + PASOS_APRENDIZAJE[paso]]);
      } else if (existia && p[0] === 0){
        // fallada en una sesión anterior: un reintento más antes de graduarla
        this.aprendizaje.set(id, [1, this.n + PASOS_APRENDIZAJE[1]]);
      } else {
        p[0] = Math.min(p[0] + 1, INTERVALOS_DIAS.length - 1); p[1] = masDias(INTERVALOS_DIAS[p[0]]);
      }
    } else {
      this.fallos++; p[3]++; p[0] = 0; p[1] = hoy();
      this.aprendizaje.set(id, [0, this.n + PASOS_APRENDIZAJE[0]]);
    }
    marcarSucio(id);
  }
  pendientes(){
    const hoyIso = hoy(); let rep = 0, nue = 0;
    for (const q of this.pool){ const p = progress[q.i]; if (!p) nue++; else if (p[1] <= hoyIso) rep++; }
    return { rep, nue };
  }
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
    sincronizarSeleccion();
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
  await api("/api/progreso", { method: "DELETE" });
  progress = {};
  await refrescarTemas();
});
$("#btn-all").addEventListener("click", () => fijarSeleccion(true));
$("#btn-none").addEventListener("click", () => fijarSeleccion(false));
$("#btn-start").addEventListener("click", empezar);

/* ---------- Test ---------- */
const ICO_OK  = '<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 11.5l4.5 4.5 8.5-9.5"/></svg>';
const ICO_BAD = '<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5.5 5.5l11 11M16.5 5.5l-11 11"/></svg>';

async function empezar(){
  if (!seleccion.size || pantalla !== "setup") return;
  const boton = $("#btn-start"); boton.disabled = true;
  setStatus("busy", "Cargando preguntas…");
  try {
    await guardarProgreso();
    const d = await (await api("/api/test?temas=" + [...seleccion].sort((a, b) => a - b).join(","))).json();
    bank = d.preguntas.map((q) => ({ i: q.id, t: q.tema, p: q.pregunta, o: q.respuestas, c: q.correcta, e: q.explicacion }));
    progress = d.progreso;
    if (!bank.length) throw new Error("Los temas elegidos no tienen preguntas.");
  } catch (e) {
    setStatus("warn", "No se pudieron cargar las preguntas: " + msgError(e)); boton.disabled = false; return;
  }
  setStatus("ok", ETIQUETA); boton.disabled = false;
  nota(null);
  sesion = new Sesion(bank);
  pantalla = "quiz";
  $("#screen-setup").hidden = true; $("#screen-quiz").hidden = false;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  preguntar();
}
function preguntar(){
  clearTimeout(timerAcierto);
  const [q, tipo] = sesion.siguiente();
  const orden = barajar(q.o.map((_, k) => k));
  cur = { q, tipo, orden, sel: 0, corr: orden.indexOf(q.c), fase: "elegir" };
  $("#q-tema").textContent = "Tema " + q.t;
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
setStatus("ok", ETIQUETA);

})();
