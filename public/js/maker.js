/* Creador de preguntas (cliente): edita directamente la base de datos a través de /api/preguntas. */
(() => {
"use strict";

const LETRAS = "ABCDEFGH";
const MAX_OPC = 8, MIN_OPC = 2, OPC_INICIALES = 4, PAGINA = 50, MAX_ETIQUETA = 60;
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
const msg = (e) => (e && e.message) ? e.message : String(e);

/* ---------- API ---------- */
class ErrorHttp extends Error { constructor(status, datos){ super(datos.error || "El servidor respondió " + status + "."); this.status = status; this.datos = datos; } }
async function api(url, metodo, cuerpo){
  const opc = { method: metodo || "GET" };
  if (cuerpo !== undefined){ opc.headers = { "Content-Type": "application/json" }; opc.body = JSON.stringify(cuerpo); }
  const r = await fetch(url, opc);
  if (r.status === 204) return null;
  let datos = {}; try { datos = await r.json(); } catch (e) {}
  if (!r.ok) throw new ErrorHttp(r.status, datos);
  return datos;
}

/* ---------- Estado ---------- */
let items = [];         // página(s) cargadas: { id, tema, pregunta, respuestas[], correcta, explicacion }
let total = 0;          // total de preguntas que cumplen el filtro
let draft = nuevoBorrador("");
let editando = null;    // id de la pregunta que se edita, o null
let envio = 0;          // descarta respuestas de listados antiguos
let temario = [];       // bloques con sus temas, tal y como llega de /api/temario
let etiquetas = new Map(); // id de tema -> { bloque, numero, nombre }

function nuevoBorrador(tema){ return { tema, pregunta: "", opciones: Array(OPC_INICIALES).fill(""), c: 0, expl: "" }; }
/* Recorta las etiquetas largas para que los desplegables no se alarguen de más. */
const recortar = (s, max = MAX_ETIQUETA) => (s.length > max ? s.slice(0, max - 3).trimEnd() + "..." : s);
const textoOpcion = (t) => "Tema " + (t.numero ?? t.id) + (t.nombre ? " — " + t.nombre : "");

/* ---------- Mensajes ---------- */
let tFlash = null;
function flash(texto, tipo){
  const f = $("#flash"); f.textContent = texto; f.dataset.tipo = tipo || "";
  clearTimeout(tFlash); tFlash = setTimeout(() => { f.textContent = ""; }, 4000);
}
function mostrarError(texto, accion){
  const e = $("#f-error");
  const partes = [h("span", { text: texto })];
  if (accion) partes.push(h("button", { class: "btn small", type: "button", onclick: accion.fn, text: accion.texto }));
  e.replaceChildren(...partes);
  e.hidden = false;
}
function ocultarError(){ $("#f-error").hidden = true; }
function setStatus(kind, text){ const s = $("#status"); s.dataset.state = kind; s.textContent = text; }

/* ---------- Editor ---------- */
function pintarEditor(){
  const sel = $("#f-tema"), valor = String(draft.tema ?? "");
  if ([...sel.options].some((o) => o.value === valor)) sel.value = valor;
  else if (sel.options.length){ sel.selectedIndex = 0; draft.tema = sel.value; }
  else draft.tema = "";
  $("#f-preg").value = draft.pregunta;
  $("#f-expl").value = draft.expl;
  pintarOpciones();
  const ed = editando !== null;
  $("#ed-title").textContent = ed ? "Editar pregunta" : "Nueva pregunta";
  $("#ed-mode").textContent = ed ? "Editando la nº " + editando : "";
  $("#btn-save").replaceChildren(ed ? "Guardar cambios " : "Añadir pregunta ", h("kbd", { text: "Ctrl+Enter" }));
  $("#btn-cancel").hidden = !ed;
  ocultarError();
}
function pintarOpciones(){
  const cont = $("#f-opts");
  cont.replaceChildren(...draft.opciones.map((t, k) =>
    h("div", { class: "orow" },
      h("button", { type: "button", class: "bub" + (draft.c === k ? " on" : ""), tabindex: "-1", "aria-label": "Marcar la opción " + LETRAS[k] + " como correcta", onclick: () => marcarCorrecta(k), text: LETRAS[k] }),
      h("input", { type: "text", id: "o-" + k, value: t, "aria-label": "Opción " + LETRAS[k], autocomplete: "off",
        oninput: (e) => { draft.opciones[k] = e.target.value; },
        onkeydown: (e) => {
          if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          const sig = $("#o-" + (k + 1));
          if (sig) sig.focus();
          else { const r = $("#f-correct input:checked") || $("#f-correct input"); if (r) r.focus(); }
        } }),
      h("button", { type: "button", class: "x", tabindex: "-1", "aria-label": "Quitar la opción " + LETRAS[k], onclick: () => quitarOpcion(k), text: "×" }))));
  const g = $("#f-correct");
  g.replaceChildren(...draft.opciones.map((_, k) => {
    const inp = h("input", { type: "radio", name: "correcta", id: "c-" + k, value: String(k) });
    inp.checked = draft.c === k;
    inp.addEventListener("change", () => marcarCorrecta(k, true));
    return h("span", { class: "pill" }, inp, h("label", { for: "c-" + k, text: LETRAS[k] }));
  }));
  $("#btn-add-opt").disabled = draft.opciones.length >= MAX_OPC;
}
function marcarCorrecta(k, desdeRadio){
  draft.c = k;
  document.querySelectorAll("#f-opts .bub").forEach((b, i) => b.classList.toggle("on", i === k));
  if (!desdeRadio) document.querySelectorAll("#f-correct input").forEach((r, i) => { r.checked = i === k; });
}
function anadirOpcion(){
  if (draft.opciones.length >= MAX_OPC) return;
  draft.opciones.push(""); pintarOpciones(); $("#o-" + (draft.opciones.length - 1)).focus();
}
function quitarOpcion(k){
  if (draft.opciones.length <= MIN_OPC){ flash("Hacen falta al menos 2 opciones.", "warn"); return; }
  draft.opciones.splice(k, 1);
  if (draft.c === k) draft.c = 0; else if (draft.c > k) draft.c--;
  pintarOpciones();
}

/* ---------- Validar y guardar una pregunta ---------- */
function validarBorrador(){
  const sel = $("#f-tema");
  const tema = Number(sel.value);
  if (!sel.value || !Number.isInteger(tema) || tema < 0)
    return { msg: "Elige un tema. Si todavía no existe, créalo en Organizar temario.", foco: "#f-tema" };
  draft.tema = String(tema);
  const pregunta = draft.pregunta.trim();
  if (!pregunta) return { msg: "Escribe la pregunta.", foco: "#f-preg" };
  const llenas = []; draft.opciones.forEach((t, k) => { if (t.trim()) llenas.push(k); });
  if (llenas.length < MIN_OPC){
    const vacia = draft.opciones.findIndex((t) => !t.trim());
    return { msg: "Escribe al menos dos opciones.", foco: "#o-" + Math.max(0, vacia) };
  }
  if (!llenas.includes(draft.c)) return { msg: "La respuesta correcta (" + LETRAS[draft.c] + ") es una opción vacía. Elige otra o rellénala.", foco: "#f-correct input:checked" };
  const respuestas = llenas.map((k) => draft.opciones[k].trim());
  const vistas = new Set();
  for (const r of respuestas){ const kk = r.toLowerCase(); if (vistas.has(kk)) return { msg: "Hay dos opciones iguales: «" + r + "».", foco: "#o-" + llenas[respuestas.indexOf(r)] }; vistas.add(kk); }
  return { q: { tema, pregunta, respuestas, correcta: llenas.indexOf(draft.c), explicacion: draft.expl.trim() } };
}
function cuerpoDe(q){ return { tema: q.tema, pregunta: q.pregunta, respuestas: q.respuestas, correcta: q.correcta, explicacion: q.explicacion }; }

async function guardarPregunta(){
  const r = validarBorrador();
  if (r.msg){ mostrarError(r.msg); const f = $(r.foco); if (f) f.focus(); return; }
  try {
    await persistir(r.q, editando);
  } catch (e) {
    if (e.status === 409 && e.datos.existente){
      const ex = e.datos.existente;
      mostrarError(e.message, { texto: "Reemplazarla", fn: () => persistir(r.q, ex.id, true).catch((e2) => mostrarError(msg(e2))) });
    } else mostrarError(msg(e));
  }
}
/* Crea (id null) o actualiza una pregunta. Con `reemplazo`, la pregunta que se estaba editando se borra (queda fusionada). */
async function persistir(q, id, reemplazo){
  const edicion = id !== null;
  setStatus("busy", "Guardando…");
  try {
    await (edicion ? api("/api/preguntas/" + id, "PUT", cuerpoDe(q)) : api("/api/preguntas", "POST", cuerpoDe(q)));
    if (reemplazo && editando !== null && editando !== id) await api("/api/preguntas/" + editando, "DELETE");
  } catch (e) { setStatus("warn", "No se pudo guardar"); throw e; }
  setStatus("ok", "Guardado en la base de datos");
  editando = null;
  draft = nuevoBorrador(String(q.tema));
  pintarEditor();
  await recargar();
  flash((edicion ? "Cambios guardados" : "Pregunta añadida") + " · " + total + " en la lista");
  $("#f-preg").focus();
}
function limpiar(){
  editando = null; draft = nuevoBorrador(draft.tema);
  pintarEditor(); pintarLista(); $("#f-preg").focus();
}

/* ---------- Lista (paginada desde el servidor) ---------- */
/* Opciones del selector de tema, agrupadas por bloque. */
function opcionesSelect(seleccionado){
  if (!temario.some((b) => b.temas.length)) return [h("option", { value: "", text: "No hay temas todavía" })];
  const partes = [];
  for (const b of temario){
    if (!b.temas.length) continue;
    const g = h("optgroup", { label: recortar(b.nombre) });
    for (const t of b.temas){
      g.append(h("option", { value: String(t.id), text: recortar(textoOpcion(t) + (t.preguntas === 0 ? " (sin preguntas)" : "")) }));
    }
    partes.push(g);
  }
  return partes;
}
async function cargarTemas(){
  const filtro = $("#f-filtro"), filtroActual = filtro.value;
  const selTema = $("#f-tema"), temaActual = draft.tema || selTema.value;
  temario = await api("/api/temario");
  etiquetas = new Map();
  for (const b of temario) for (const t of b.temas) etiquetas.set(t.id, { bloque: b.nombre, numero: t.numero, nombre: t.nombre });

  const suma = temario.reduce((s, b) => s + b.temas.reduce((x, t) => x + t.preguntas, 0), 0);
  filtro.replaceChildren(h("option", { value: "", text: "Todos los temas (" + suma + ")" }),
    ...temario.filter((b) => b.temas.length).map((b) => {
      const g = h("optgroup", { label: recortar(b.nombre) });
      g.append(...b.temas.map((t) => h("option", { value: String(t.id), text: recortar(textoOpcion(t) + " (" + t.preguntas + ")") })));
      return g;
    }));
  filtro.value = temario.some((b) => b.temas.some((t) => String(t.id) === filtroActual)) ? filtroActual : "";

  const ids = new Set(temario.flatMap((b) => b.temas).map((t) => String(t.id)));
  let elegido = String(temaActual ?? "");
  if (!ids.has(elegido)) elegido = temario.flatMap((b) => b.temas)[0] ? String(temario.flatMap((b) => b.temas)[0].id) : "";
  draft.tema = elegido;
  selTema.replaceChildren(...opcionesSelect(elegido));
  selTema.value = elegido;
}
function parametros(desde){
  const p = new URLSearchParams({ limite: String(PAGINA), desde: String(desde) });
  if ($("#f-filtro").value !== "") p.set("tema", $("#f-filtro").value);
  const q = $("#f-buscar").value.trim(); if (q) p.set("q", q);
  return p;
}
/* Vuelve a pedir la lista desde el principio, conservando tantas filas como ya había cargadas. */
async function recargar(){
  const mio = ++envio;
  try {
    await cargarTemas();
    const d = await api("/api/preguntas?" + parametros(0));
    if (mio !== envio) return;
    items = d.items; total = d.total;
    pintarLista();
  } catch (e) { setStatus("warn", "No se pudo cargar la lista: " + msg(e)); }
}
async function masPreguntas(){
  const mio = ++envio;
  try {
    const d = await api("/api/preguntas?" + parametros(items.length));
    if (mio !== envio) return;
    items = items.concat(d.items); total = d.total;
    pintarLista();
  } catch (e) { setStatus("warn", "No se pudo cargar la lista: " + msg(e)); }
}
function pintarLista(){
  $("#count").textContent = total ? "· " + total + (total === 1 ? " pregunta" : " preguntas") : "";
  $("#empty").hidden = items.length > 0;
  $("#btn-more").hidden = items.length >= total;
  $("#list").replaceChildren(...items.map((q) => {
    const et = etiquetas.get(q.tema);
    return h("li", { class: "item" + (q.id === editando ? " editing" : "") },
      h("div", { class: "imain" },
        h("span", { class: "itag", text: "T" + (et?.numero ?? q.tema), title: et?.bloque ?? "" }),
        h("span", { class: "itext", text: q.pregunta })),
      h("div", { class: "imeta", text: "nº " + q.id + (et ? " · " + et.bloque : "") + " · " + q.respuestas.length + " opciones · correcta " + LETRAS[q.correcta] }),
      h("div", { class: "iact" },
        h("button", { class: "btn small", type: "button", text: "Editar", onclick: () => editar(q) }),
        h("button", { class: "btn small", type: "button", text: "Duplicar", onclick: () => duplicar(q) }),
        confirmable("Borrar", () => borrar(q.id))));
  }));
}
function confirmable(texto, fn){
  const b = h("button", { class: "btn small danger", type: "button", text: texto });
  let t = null;
  b.addEventListener("click", () => {
    if (!b.classList.contains("armed")){
      b.classList.add("armed"); b.textContent = "¿Seguro?";
      t = setTimeout(() => { b.classList.remove("armed"); b.textContent = texto; }, 3000);
    } else { clearTimeout(t); fn(); }
  });
  return b;
}
function cargarEnBorrador(q){
  draft = { tema: String(q.tema), pregunta: q.pregunta, opciones: q.respuestas.slice(), c: q.correcta, expl: q.explicacion };
}
function editar(q){
  editando = q.id; cargarEnBorrador(q);
  pintarEditor(); pintarLista();
  $("#f-preg").focus(); $("#ed-title").scrollIntoView({ block: "start", behavior: "smooth" });
}
function duplicar(q){
  editando = null; cargarEnBorrador(q);
  pintarEditor(); pintarLista(); $("#f-preg").focus();
  flash("Copia cargada: cambia el enunciado y añádela.");
}
async function borrar(id){
  try { await api("/api/preguntas/" + id, "DELETE"); }
  catch (e) { flash("No se pudo borrar: " + msg(e), "warn"); return; }
  if (editando === id){ editando = null; draft = nuevoBorrador(draft.tema); pintarEditor(); }
  await recargar();
}

/* ---------- Eventos ---------- */
$("#f-tema").addEventListener("change", (e) => { draft.tema = e.target.value; });
$("#f-preg").addEventListener("input", (e) => { draft.pregunta = e.target.value; });
$("#f-expl").addEventListener("input", (e) => { draft.expl = e.target.value; });
$("#f-filtro").addEventListener("change", recargar);
let tBuscar = null;
$("#f-buscar").addEventListener("input", () => { clearTimeout(tBuscar); tBuscar = setTimeout(recargar, 250); });
$("#btn-more").addEventListener("click", masPreguntas);
$("#btn-add-opt").addEventListener("click", anadirOpcion);
$("#btn-save").addEventListener("click", guardarPregunta);
$("#btn-cancel").addEventListener("click", limpiar);
$("#btn-clear").addEventListener("click", limpiar);
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.repeat){ e.preventDefault(); guardarPregunta(); }
});

/* ---------- Arranque ---------- */
pintarEditor();
recargar();
$("#f-preg").focus();

})();
