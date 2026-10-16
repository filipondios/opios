/* Lógica del creador de preguntas: edición, sesión y exportación. */
(() => {
"use strict";

const LETRAS = "ABCDEFGH";
const MAX_OPC = 8, MIN_OPC = 2, OPC_INICIALES = 4;
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
const clave = (t) => t.replace(/\s+/g, " ").trim();
const msg = (e) => (e && e.message) ? e.message : String(e);

/* ---------- Estado ---------- */
let items = [];         // { tema, pregunta, respuestas[], c, explicacion }
let draft = nuevoBorrador("");
let editando = null;    // índice en items, o null
let dirHandle = null;
const soportaCarpeta = typeof window.showDirectoryPicker === "function";

function nuevoBorrador(tema){ return { tema, pregunta: "", opciones: Array(OPC_INICIALES).fill(""), c: 0, expl: "" }; }

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

/* ---------- Editor ---------- */
function pintarEditor(){
  $("#f-tema").value = draft.tema;
  $("#f-preg").value = draft.pregunta;
  $("#f-expl").value = draft.expl;
  pintarOpciones();
  const ed = editando !== null;
  $("#ed-title").textContent = ed ? "Editar pregunta" : "Nueva pregunta";
  $("#ed-mode").textContent = ed ? "Editando la nº " + (editando + 1) : "";
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
  const tema = Number(draft.tema);
  if (String(draft.tema).trim() === "" || !Number.isInteger(tema) || tema < 0) return { msg: "El tema debe ser un número entero (0 o más).", foco: "#f-tema" };
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
  return { q: { tema, pregunta, respuestas, c: llenas.indexOf(draft.c), explicacion: draft.expl.trim() } };
}
function guardarPregunta(){
  const r = validarBorrador();
  if (r.msg){ mostrarError(r.msg); const f = $(r.foco); if (f) f.focus(); return; }
  const q = r.q, k = clave(q.pregunta);
  const dup = items.findIndex((x, i) => i !== editando && clave(x.pregunta) === k);
  if (dup >= 0){
    mostrarError("Ya hay una pregunta con este mismo enunciado (nº " + (dup + 1) + ", tema " + items[dup].tema + ").", { texto: "Reemplazarla", fn: () => aplicar(q, dup) });
    return;
  }
  aplicar(q, editando);
}
function aplicar(q, indice){
  const edicion = indice !== null && indice !== undefined;
  if (edicion){
    items[indice] = q;
    if (editando !== null && editando !== indice) items.splice(editando, 1);
  } else items.push(q);
  const n = items.length;
  editando = null;
  draft = nuevoBorrador(String(q.tema));
  pintarEditor(); pintarLista();
  flash((edicion ? "Cambios guardados" : "Pregunta añadida") + " · " + n + " en total");
  $("#f-preg").focus();
}
function limpiar(){
  editando = null; draft = nuevoBorrador(draft.tema);
  pintarEditor(); pintarLista(); $("#f-preg").focus();
}

/* ---------- Lista ---------- */
function pintarFiltro(){
  const sel = $("#f-filtro"), actual = sel.value;
  const temas = [...new Set(items.map((q) => q.tema))].sort((a, b) => a - b);
  sel.replaceChildren(h("option", { value: "", text: "Todos los temas" }), ...temas.map((t) => h("option", { value: String(t), text: "Tema " + t })));
  sel.value = temas.map(String).includes(actual) ? actual : "";
}
function pintarLista(){
  pintarFiltro();
  const filtro = $("#f-filtro").value;
  const temas = new Set(items.map((q) => q.tema)).size;
  $("#count").textContent = items.length ? "· " + items.length + (items.length === 1 ? " pregunta" : " preguntas") + " en " + temas + (temas === 1 ? " tema" : " temas") : "";
  $("#empty").hidden = items.length > 0;
  $("#f-filtro").hidden = items.length === 0;
  const idx = items.map((_, i) => i).filter((i) => filtro === "" || String(items[i].tema) === filtro).reverse();
  $("#list").replaceChildren(...idx.map((i) => {
    const q = items[i];
    return h("li", { class: "item" + (i === editando ? " editing" : "") },
      h("div", { class: "imain" }, h("span", { class: "itag", text: "T" + q.tema }), h("span", { class: "itext", text: q.pregunta })),
      h("div", { class: "imeta", text: "nº " + (i + 1) + " · " + q.respuestas.length + " opciones · correcta " + LETRAS[q.c] }),
      h("div", { class: "iact" },
        h("button", { class: "btn small", type: "button", text: "Editar", onclick: () => editar(i) }),
        h("button", { class: "btn small", type: "button", text: "Duplicar", onclick: () => duplicar(i) }),
        confirmable("Borrar", () => borrar(i))));
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
  draft = { tema: String(q.tema), pregunta: q.pregunta, opciones: q.respuestas.slice(), c: q.c, expl: q.explicacion };
}
function editar(i){
  editando = i; cargarEnBorrador(items[i]);
  pintarEditor(); pintarLista();
  $("#f-preg").focus(); $("#ed-title").scrollIntoView({ block: "start", behavior: "smooth" });
}
function duplicar(i){
  editando = null; cargarEnBorrador(items[i]);
  pintarEditor(); $("#f-preg").focus();
  flash("Copia cargada: cambia el enunciado y añádela.");
}
function borrar(i){
  items.splice(i, 1);
  if (editando === i) { editando = null; draft = nuevoBorrador(draft.tema); pintarEditor(); }
  else if (editando !== null && editando > i) editando--;
  pintarLista();
}

/* ---------- Exportar ---------- */
function serializar(arr){
  const orden = arr.map((q, i) => [q, i]).sort((a, b) => a[0].tema - b[0].tema || a[1] - b[1]).map((x) => x[0]);
  const trozos = orden.map((q) => [
    "  {",
    '    "tema": ' + q.tema + ",",
    '    "pregunta": ' + JSON.stringify(q.pregunta) + ",",
    '    "respuestas": [' + q.respuestas.map((r) => JSON.stringify(r)).join(", ") + "],",
    '    "respuesta_correcta": "' + LETRAS[q.c].toLowerCase() + '",',
    '    "explicacion": ' + JSON.stringify(q.explicacion),
    "  }"].join("\n"));
  return "[\n" + trozos.join(",\n") + "\n]\n";
}
function nombreArchivo(){
  let n = $("#f-name").value.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!n) n = "preguntas_nuevas";
  if (!/\.json$/i.test(n)) n += ".json";
  $("#f-name").value = n;
  return n;
}
async function guardarEnCarpeta(){
  if (!items.length){ flash("No hay preguntas que exportar.", "warn"); return; }
  if (!soportaCarpeta){ flash("Este navegador no permite guardar directamente en la carpeta preguntas. Usa Chrome o Edge.", "warn"); return; }
  try {
    if (!dirHandle){
      dirHandle = await window.showDirectoryPicker({ id: "preguntas-servidor", mode: "readwrite" });
      if (dirHandle.name.toLocaleLowerCase() !== "preguntas"){
        dirHandle = null;
        flash("Selecciona la carpeta «preguntas» junto a la página.", "warn");
        return;
      }
    }
    const permiso = { mode: "readwrite" };
    if (await dirHandle.queryPermission(permiso) !== "granted" &&
        await dirHandle.requestPermission(permiso) !== "granted"){
      dirHandle = null;
      flash("Sin permiso para escribir en la carpeta «preguntas».", "warn");
      return;
    }
    const nombre = nombreArchivo();
    const fh = await dirHandle.getFileHandle(nombre, { create: true });
    const w = await fh.createWritable();
    await w.write(serializar(items)); await w.close();
    flash("Guardado «" + nombre + "» en «preguntas» (" + items.length + " preguntas).");
  } catch (e) {
    if (e && e.name === "AbortError") return;
    flash("No se pudo guardar: " + msg(e), "warn");
  }
}

/* ---------- Eventos ---------- */
$("#f-tema").addEventListener("input", (e) => { draft.tema = e.target.value; });
$("#f-tema").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey){ e.preventDefault(); $("#f-preg").focus(); } });
$("#f-preg").addEventListener("input", (e) => { draft.pregunta = e.target.value; });
$("#f-expl").addEventListener("input", (e) => { draft.expl = e.target.value; });
$("#f-filtro").addEventListener("change", pintarLista);
$("#btn-add-opt").addEventListener("click", anadirOpcion);
$("#btn-save").addEventListener("click", guardarPregunta);
$("#btn-cancel").addEventListener("click", limpiar);
$("#btn-clear").addEventListener("click", limpiar);
$("#btn-export").addEventListener("click", guardarEnCarpeta);
(function(){
  const b = $("#btn-wipe"); let t = null; const txt = b.textContent;
  b.addEventListener("click", () => {
    if (!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent = "¿Seguro? Pulsa otra vez"; t = setTimeout(() => { b.classList.remove("armed"); b.textContent = txt; }, 3500); return; }
    clearTimeout(t); b.classList.remove("armed"); b.textContent = txt;
    items = []; editando = null; draft = nuevoBorrador(draft.tema); pintarEditor(); pintarLista();
    flash("Lista vaciada.");
  });
})();
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.repeat){ e.preventDefault(); guardarPregunta(); }
});
/* ---------- Arranque ---------- */
(async function(){
  pintarEditor(); pintarLista();
  $("#f-preg").focus();
})();

})();
