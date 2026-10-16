/* Lógica de Test infinito: almacenamiento, repaso y UI. */
(() => {
"use strict";

/* ---------- Parámetros del repaso (ajústalos a tu gusto) ---------- */
const INTERVALOS_DIAS   = [0, 1, 3, 7, 16, 35, 90]; // días hasta el siguiente repaso según la caja
const PASOS_APRENDIZAJE = [3, 8];  // tras fallar: reaparece tras 3 preguntas, luego tras 8
const PROB_REPASO       = 0.6;     // si hay repasos y nuevas a la vez, probabilidad de sacar un repaso
const CAJA_DOMINADA     = 4;       // desde esta caja una pregunta cuenta como dominada
const PAUSA_ACIERTO_MS  = 450;     // pausa tras un acierto antes de pasar a la siguiente
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

function hash(str){ // cyrb53 → 14 caracteres hexadecimales
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++){ const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1>>>16), 2246822507); h1 ^= Math.imul(h2 ^ (h2>>>13), 3266489909);
  h2 = Math.imul(h2 ^ (h2>>>16), 2246822507); h2 ^= Math.imul(h1 ^ (h1>>>13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/* ---------- Validación de preguntas ---------- */
function normalizar(p){
  if (!p || typeof p !== "object" || Array.isArray(p)) return { error: "no es un objeto" };
  const tema = Number(p.tema);
  if (p.tema === "" || p.tema == null || !Number.isInteger(tema) || tema < 0) return { error: "'tema' debe ser un número entero" };
  const pregunta = typeof p.pregunta === "string" ? p.pregunta.trim() : "";
  if (!pregunta) return { error: "falta 'pregunta'" };
  if (!Array.isArray(p.respuestas) || p.respuestas.length < 2 || p.respuestas.length > LETRAS.length)
    return { error: "'respuestas' debe ser una lista de 2 a " + LETRAS.length + " opciones" };
  const o = p.respuestas.map((x) => String(x).trim());
  if (o.some((x) => !x)) return { error: "hay una opción vacía en 'respuestas'" };
  let c = 0;
  const rc = p.respuesta_correcta;
  if (rc != null && String(rc).trim() !== ""){
    const s = String(rc).trim();
    const n = s.toLowerCase().charCodeAt(0) - 97;
    if (/^[a-z]$/i.test(s) && n < o.length) c = n;
    else { c = o.indexOf(s); if (c < 0) return { error: "'respuesta_correcta' debe ser una letra (a, b, c...) que corresponda a una opción" }; }
  }
  const e = typeof p.explicacion === "string" ? p.explicacion.trim() : "";
  return { q: { i: hash(pregunta.replace(/\s+/g, " ")), t: tema, p: pregunta, o, c, e } };
}

/* ---------- Almacenamiento ---------- */
function localBackend(){
  const leer = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const escribir = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  return {
    etiqueta: "Guardado solo en este navegador",
    async load(){ const b = leer("ti.bank"), p = leer("ti.prog"); return { bank: Array.isArray(b) ? b : [], prog: (p && typeof p === "object") ? p : {} }; },
    async saveBank(bank){ escribir("ti.bank", bank); },
    async saveProg(prog){ escribir("ti.prog", prog); },
    async clearBank(){ localStorage.removeItem("ti.bank"); },
    async clearProg(){ localStorage.removeItem("ti.prog"); },
  };
}

function dbBackend(db, uid){
  const col = db.collection("data/users/" + uid);
  const bankIds = new Set(), progIds = new Set();
  let cola = Promise.resolve();
  const enCola = (fn) => { const r = cola.then(fn); cola = r.catch(() => {}); return r; };
  const trocear = (qs) => {
    const trozos = []; let cur = [], tam = 0;
    for (const q of qs){
      const n = JSON.stringify(q).length;
      if (cur.length && tam + n > 180000){ trozos.push(cur); cur = []; tam = 0; }
      cur.push(q); tam += n;
    }
    if (cur.length) trozos.push(cur);
    return trozos;
  };
  return {
    etiqueta: "Guardado en tu cuenta",
    load: () => enCola(async () => {
      const snap = await col.limit(1000).get();
      const bank = [], prog = {};
      for (const d of snap.docs){
        const data = d.data() || {};
        if (d.id.startsWith("b-")){ bankIds.add(d.id); if (Array.isArray(data.q)) bank.push(...data.q); }
        else if (d.id.startsWith("p-")){ progIds.add(d.id); Object.assign(prog, data.p || {}); }
      }
      return { bank, prog };
    }),
    saveBank: (bank, temas) => enCola(async () => {
      const porTema = new Map();
      for (const q of bank){ if (!porTema.has(q.t)) porTema.set(q.t, []); porTema.get(q.t).push(q); }
      for (const t of temas){
        const trozos = trocear(porTema.get(t) || []);
        const nuevos = new Set();
        for (let k = 0; k < trozos.length; k++){
          const id = "b-" + t + "-" + k; nuevos.add(id);
          await col.doc(id).set({ q: trozos[k] }); bankIds.add(id);
        }
        for (const id of [...bankIds]){
          if (id.startsWith("b-" + t + "-") && !nuevos.has(id)){ await col.doc(id).delete(); bankIds.delete(id); }
        }
      }
    }),
    saveProg: (prog, claves) => enCola(async () => {
      for (const k of claves){
        const sub = {};
        for (const id of Object.keys(prog)) if (id[0] === k) sub[id] = prog[id];
        await col.doc("p-" + k).set({ p: sub }); progIds.add("p-" + k);
      }
    }),
    clearProg: () => enCola(async () => { for (const id of [...progIds]){ await col.doc(id).delete(); progIds.delete(id); } }),
    clearBank: () => enCola(async () => { for (const id of [...bankIds]){ await col.doc(id).delete(); bankIds.delete(id); } }),
  };
}

async function elegirBackend(){
  try {
    if (window.claude && typeof window.claude.use === "function"){
      const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
      if (db && user){ const uid = await user.id(); if (uid) return dbBackend(db, uid); }
    }
  } catch (e) { /* se usa el almacenamiento del navegador */ }
  return localBackend();
}

/* ---------- Estado ---------- */
let backend = null;
let bank = [];          // {i,t,p,o,c,e}
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

/* ---------- Progreso: guardado diferido ---------- */
function marcarSucio(id){
  sucios.add(id[0]);
  clearTimeout(timerGuardado);
  timerGuardado = setTimeout(guardarProgreso, 700);
}
async function guardarProgreso(){
  clearTimeout(timerGuardado);
  if (!sucios.size || !backend) return;
  const claves = [...sucios]; sucios.clear();
  setStatus("busy", "Guardando…");
  try { await backend.saveProg(progress, claves); setStatus("ok", backend.etiqueta); }
  catch (e) { claves.forEach((k) => sucios.add(k)); setStatus("warn", "No se pudo guardar: " + msgError(e)); }
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

/* ---------- Pantalla de preparación ---------- */
function estadisticas(){
  const hoyIso = hoy(), m = new Map();
  for (const q of bank){
    let s = m.get(q.t); if (!s){ s = { tema: q.t, total: 0, nuevas: 0, repaso: 0, dominadas: 0, aprendiendo: 0 }; m.set(q.t, s); }
    s.total++;
    const p = progress[q.i];
    if (!p) s.nuevas++;
    else { if (p[1] <= hoyIso) s.repaso++; if (p[0] >= CAJA_DOMINADA) s.dominadas++; else s.aprendiendo++; }
  }
  return [...m.values()].sort((a, b) => a.tema - b.tema);
}
function guardarSeleccion(){ try { localStorage.setItem("ti.sel", JSON.stringify([...seleccion])); } catch (e) {} }
function leerSeleccion(){ try { const v = JSON.parse(localStorage.getItem("ti.sel")); return Array.isArray(v) ? v : null; } catch (e) { return null; } }
let seleccionLista = false;

function renderSetup(){
  $("#loading").hidden = true;
  const vacio = bank.length === 0;
  $("#empty").hidden = !vacio; $("#ready").hidden = vacio;
  if (vacio) return;
  const st = estadisticas();
  const existentes = new Set(st.map((s) => s.tema));
  if (!seleccionLista){
    const previa = leerSeleccion();
    seleccion = new Set((previa || []).filter((t) => existentes.has(t)));
    if (!seleccion.size) seleccion = new Set(existentes);
    seleccionLista = true;
  }
  for (const t of [...seleccion]) if (!existentes.has(t)) seleccion.delete(t);
  $("#grid").replaceChildren(...st.map(chip));
  actualizarResumen();
}
function chip(s){
  const barra = h("span", { class: "bar", "aria-hidden": "true" });
  for (const [cls, n] of [["b-ok", s.dominadas], ["b-mid", s.aprendiendo], ["b-new", s.nuevas]]){
    const i = h("i", { class: cls }); i.style.width = (n / s.total * 100) + "%"; barra.append(i);
  }
  return h("button", {
    class: "chip", type: "button", role: "checkbox", "aria-checked": String(seleccion.has(s.tema)),
    onclick: (e) => alternar(s.tema, e.currentTarget), onmousedown: (e) => e.preventDefault(),
  },
    h("span", { class: "chip-top" }, h("span", { class: "chip-label", text: "Tema" }), h("span", { class: "chip-num", text: String(s.tema) })),
    h("span", { class: "chip-meta", text: s.total + (s.total === 1 ? " pregunta" : " preguntas") }),
    barra,
    h("span", { class: "chip-due", text: s.repaso ? s.repaso + " por repasar hoy" : "Sin repasos hoy" }));
}
function alternar(t, btn){
  if (seleccion.has(t)) seleccion.delete(t); else seleccion.add(t);
  btn.setAttribute("aria-checked", String(seleccion.has(t)));
  actualizarResumen(); guardarSeleccion();
}
function fijarSeleccion(todos){
  seleccion = todos ? new Set(bank.map((q) => q.t)) : new Set();
  document.querySelectorAll(".chip").forEach((c, k) => c.setAttribute("aria-checked", String(todos)));
  actualizarResumen(); guardarSeleccion();
}
function actualizarResumen(){
  let total = 0, nuevas = 0, repaso = 0;
  for (const s of estadisticas()) if (seleccion.has(s.tema)){ total += s.total; nuevas += s.nuevas; repaso += s.repaso; }
  const sum = $("#sum");
  sum.replaceChildren();
  if (!seleccion.size){ sum.textContent = "Marca al menos un tema para empezar."; }
  else sum.append(h("b", { text: String(total) }), " preguntas · ", h("b", { text: String(repaso) }), " por repasar hoy · ", h("b", { text: String(nuevas) }), " nuevas");
  $("#btn-start").disabled = !seleccion.size;
}

/* ---------- Carga del banco desde preguntas/ ---------- */
async function cargarBancoDeDirectorio(){
  const directorio = new URL("preguntas/", document.baseURI);
  const respuesta = await fetch(directorio, { cache: "no-store" });
  if (!respuesta.ok) throw new Error("El servidor respondió " + respuesta.status + " al consultar preguntas/.");

  const listado = new DOMParser().parseFromString(await respuesta.text(), "text/html");
  const archivos = [...listado.querySelectorAll("a[href]")].map((enlace) => {
    try { return new URL(enlace.getAttribute("href"), directorio); } catch (e) { return null; }
  }).filter((url) => {
    if (!url || url.origin !== directorio.origin || !url.pathname.startsWith(directorio.pathname)) return false;
    const nombre = url.pathname.slice(directorio.pathname.length);
    return nombre && !nombre.includes("/") && /\.json$/i.test(nombre);
  });
  if (!archivos.length) throw new Error("No se encontraron archivos JSON en preguntas/ o el servidor no permite listar el directorio.");

  const porId = new Map(), errores = [];
  await Promise.all(archivos.map(async (url) => {
    const nombre = decodeURIComponent(url.pathname.slice(directorio.pathname.length));
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(nombre + ": el servidor respondió " + r.status + ".");
    let datos;
    try { datos = await r.json(); }
    catch (e) { throw new Error(nombre + ": JSON no válido (" + msgError(e) + ")."); }
    if (!Array.isArray(datos)) datos = datos && Array.isArray(datos.preguntas) ? datos.preguntas : null;
    if (!datos) throw new Error(nombre + ": debe contener una lista de preguntas.");
    datos.forEach((pregunta, indice) => {
      const normalizada = normalizar(pregunta);
      if (normalizada.error) errores.push(nombre + " #" + (indice + 1) + ": " + normalizada.error);
      else porId.set(normalizada.q.i, normalizada.q);
    });
  }));
  if (errores.length) throw new Error(errores.slice(0, 6).join("; ") + (errores.length > 6 ? "; y " + (errores.length - 6) + " errores más" : ""));
  if (!porId.size) throw new Error("Los archivos JSON no contienen preguntas válidas.");
  return { bank: [...porId.values()], archivos: archivos.length };
}
function bancosIguales(a, b){
  const ordenar = (preguntas) => preguntas.slice().sort((x, y) => x.i.localeCompare(y.i));
  return JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b));
}

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
  clearTimeout(timerGuardado); sucios.clear(); await backend.clearProg(); progress = {}; renderSetup();
});
$("#btn-all").addEventListener("click", () => fijarSeleccion(true));
$("#btn-none").addEventListener("click", () => fijarSeleccion(false));
$("#btn-start").addEventListener("click", empezar);

/* ---------- Test ---------- */
const ICO_OK  = '<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 11.5l4.5 4.5 8.5-9.5"/></svg>';
const ICO_BAD = '<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5.5 5.5l11 11M16.5 5.5l-11 11"/></svg>';

function empezar(){
  if (!seleccion.size) return;
  const pool = bank.filter((q) => seleccion.has(q.t));
  if (!pool.length) return;
  nota(null);
  sesion = new Sesion(pool);
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

function salir(){
  if (pantalla !== "quiz") return;
  clearTimeout(timerAcierto);
  const { aciertos, n } = sesion;
  pantalla = "setup"; cur = null;
  $("#screen-quiz").hidden = true; $("#screen-setup").hidden = false;
  guardarProgreso();
  renderSetup();
  nota(n ? "Sesión terminada: " + aciertos + " de " + n + " acertadas (" + Math.round(100 * aciertos / n) + " %)." : null);
  window.scrollTo(0, 0);
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
(async function arrancar(){
  backend = await elegirBackend();
  let bancoGuardado = [];
  let aviso = null;
  try {
    const d = await backend.load();
    bancoGuardado = d.bank;
    progress = d.prog;
  } catch (e) {
    progress = {};
    aviso = "No se pudo leer lo guardado: " + msgError(e);
  }
  try {
    const resultado = await cargarBancoDeDirectorio();
    bank = resultado.bank;
    if (!bancosIguales(bancoGuardado, bank)){
      await backend.clearBank();
      await backend.saveBank(bank, new Set(bank.map((q) => q.t)));
    }
    if (!aviso) setStatus("ok", backend.etiqueta);
    else setStatus("warn", aviso);
  } catch (e) {
    bank = [];
    aviso = "No se pudieron cargar las preguntas desde preguntas/.";
    setStatus("warn", aviso);
    nota(aviso, [msgError(e)]);
  }
  renderSetup();
})();

})();
