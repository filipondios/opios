/* Página del temario (cliente): gestiona bloques y temas contra /api/temario, /api/bloques y /api/temas. */
(() => {
"use strict";

const $ = (s) => document.querySelector(s);
function h(tag, props, ...kids){
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)){
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "disabled") e.disabled = !!v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
const msg = (e) => (e && e.message) ? e.message : String(e);
function setStatus(kind, text){ const s = $("#status"); s.dataset.state = kind; s.textContent = text; }
function nota(texto){
  const n = $("#note");
  if (!texto){ n.hidden = true; n.replaceChildren(); return; }
  n.textContent = texto; n.hidden = false;
}

/* ---------- API ---------- */
async function api(url, metodo, cuerpo){
  const opc = { method: metodo || "GET" };
  if (cuerpo !== undefined){ opc.headers = { "Content-Type": "application/json" }; opc.body = JSON.stringify(cuerpo); }
  const r = await fetch(url, opc);
  if (r.status === 204) return null;
  let datos = {}; try { datos = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(datos.error || "El servidor respondió " + r.status + ".");
  return datos;
}

/* ---------- Estado ---------- */
let bloques = [];
let modo = null; // { tipo: "bloque"|"tema", id, bloque }

/* ---------- Pintar ---------- */
function confirmable(texto, clase, fn){
  const b = h("button", { class: "btn small" + (clase ? " " + clase : ""), type: "button", text: texto });
  let t = null;
  b.addEventListener("click", async () => {
    if (!b.classList.contains("armed")){
      b.classList.add("armed"); b.textContent = "¿Seguro?";
      t = setTimeout(() => { b.classList.remove("armed"); b.textContent = texto; }, 3000);
      return;
    }
    clearTimeout(t); b.classList.remove("armed"); b.textContent = texto;
    try { await fn(); } catch (e) { nota(msg(e)); setStatus("warn", msg(e)); }
  });
  return b;
}
function siguienteNumero(b){
  const nums = b.temas.map((t) => Number(t.numero) || 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}
function filaTema(t){
  const bloque = bloques.find((b) => b.temas.includes(t));
  return h("li", { class: "tema-item" },
    h("span", { class: "tnum", text: "T" + (t.numero ?? "?") }),
    h("div", { class: "tinfo" },
      h("span", { class: "tnombre" + (t.nombre ? "" : " sin"), text: t.nombre || "Sin nombre" }),
      h("span", { class: "tmeta", text: t.preguntas + (t.preguntas === 1 ? " pregunta" : " preguntas") + " · nº " + t.id })),
    h("div", { class: "tacciones" },
      h("button", { class: "btn small", type: "button", text: "Editar", onclick: () => abrirTema(bloque, t) }),
      confirmable("Borrar", "danger", () => borrarTema(t))));
}
function pintar(){
  const reales = bloques.filter((b) => b.id != null);
  $("#vacio").hidden = bloques.length > 0;
  $("#bloques").replaceChildren(...bloques.map((b) => {
    const total = b.temas.reduce((s, t) => s + t.preguntas, 0);
    const i = reales.indexOf(b);
    return h("section", { class: "card bloque", "data-bloque": b.id ?? "" },
      h("div", { class: "bloque-head" },
        h("div", { class: "bloque-titulo" },
          h("h2", { text: b.nombre }),
          h("span", { text: b.temas.length + (b.temas.length === 1 ? " tema · " : " temas · ") + total + (total === 1 ? " pregunta" : " preguntas") }),
          b.id == null ? h("span", { class: "hint", text: "Temas sin bloque: edítalos para asignarles uno." }) : null),
        h("div", { class: "bloque-acciones" },
          b.id != null ? h("button", { class: "btn small", type: "button", text: "↑", title: "Subir bloque", disabled: i === 0, onclick: () => moverBloque(i, -1) }) : null,
          b.id != null ? h("button", { class: "btn small", type: "button", text: "↓", title: "Bajar bloque", disabled: i === reales.length - 1, onclick: () => moverBloque(i, 1) }) : null,
          b.id != null ? h("button", { class: "btn small", type: "button", text: "Renombrar", onclick: () => abrirBloque(b) }) : null,
          b.id != null ? confirmable("Borrar bloque", "danger", () => borrarBloque(b)) : null,
          b.id != null ? h("button", { class: "btn small primary", type: "button", text: "+ Tema", onclick: () => abrirTema(b, null) }) : null)),
      h("ul", { class: "temas" },
        b.temas.length ? b.temas.map(filaTema) : h("li", { class: "tema-item" }, h("span", { class: "tmeta", text: "Sin temas todavía." }))));
  }));
}

/* ---------- Acciones ---------- */
async function cargar(){
  try {
    bloques = await api("/api/temario");
    pintar();
    setStatus("ok", "Guardado en la base de datos");
  } catch (e) { setStatus("warn", "No se pudo cargar el temario: " + msg(e)); }
}
async function moverBloque(i, delta){
  const reales = bloques.filter((b) => b.id != null);
  const j = i + delta;
  if (j < 0 || j >= reales.length) return;
  [reales[i], reales[j]] = [reales[j], reales[i]];
  try { await api("/api/bloques/reordenar", "POST", { ids: reales.map((b) => b.id) }); }
  catch (e) { nota(msg(e)); setStatus("warn", msg(e)); }
  await cargar();
}
async function borrarBloque(b){
  await api("/api/bloques/" + b.id, "DELETE");
  await cargar();
  nota("Bloque «" + b.nombre + "» borrado.");
}
async function borrarTema(t){
  await api("/api/temas/" + t.id, "DELETE");
  await cargar();
  nota("Tema " + (t.numero ?? t.id) + " borrado.");
}

/* ---------- Diálogo ---------- */
function mostrarError(texto){
  const e = $("#dlg-error");
  if (!texto){ e.hidden = true; e.textContent = ""; return; }
  e.textContent = texto; e.hidden = false;
}
function abrirBloque(b){
  modo = { tipo: "bloque", id: b?.id ?? null };
  $("#dlg-title").textContent = b ? "Renombrar bloque" : "Nuevo bloque";
  mostrarError(null);
  $("#dlg-campos").replaceChildren(
    h("div", { class: "field" },
      h("label", { for: "d-nombre", text: "Nombre" }),
      h("input", { id: "d-nombre", type: "text", value: b?.nombre ?? "", maxlength: 120, autocomplete: "off" })));
  $("#dlg").showModal();
  $("#d-nombre").focus(); $("#d-nombre").select();
}
function abrirTema(b, t){
  const destino = (b && b.id != null) ? b.id : (bloques.find((x) => x.id != null)?.id ?? null);
  if (destino == null){ nota("Crea un bloque antes de añadir o mover temas."); return; }
  modo = { tipo: "tema", id: t?.id ?? null, bloque: destino };
  $("#dlg-title").textContent = t ? "Editar tema" : "Nuevo tema";
  mostrarError(null);
  const select = h("select", { id: "d-bloque" });
  for (const x of bloques) if (x.id != null) select.append(h("option", { value: String(x.id), text: x.nombre }));
  select.value = String(t?.bloque ?? destino);
  $("#dlg-campos").replaceChildren(
    h("div", { class: "field" },
      h("label", { for: "d-numero", text: "Número de tema" }),
      h("input", { id: "d-numero", type: "number", min: "0", step: "1", inputmode: "numeric",
        value: String(t?.numero ?? siguienteNumero(b)) })),
    h("div", { class: "field" },
      h("label", { for: "d-tnombre", text: "Nombre (opcional)" }),
      h("input", { id: "d-tnombre", type: "text", value: t?.nombre ?? "", maxlength: 200, autocomplete: "off" })),
    h("div", { class: "field" },
      h("label", { for: "d-bloque", text: "Bloque" }),
      select));
  $("#dlg").showModal();
  $("#d-numero").focus(); $("#d-numero").select();
}

/* ---------- Eventos ---------- */
$("#btn-nuevo-bloque").addEventListener("click", () => abrirBloque(null));
$("#dlg-cancel").addEventListener("click", () => $("#dlg").close());
$("#dlg-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ok = $("#dlg-ok"); ok.disabled = true;
  try {
    if (modo.tipo === "bloque"){
      const nombre = $("#d-nombre").value.trim();
      if (!nombre) throw new Error("Escribe el nombre del bloque.");
      if (modo.id) await api("/api/bloques/" + modo.id, "PUT", { nombre });
      else await api("/api/bloques", "POST", { nombre });
    } else {
      const bloque = Number($("#d-bloque").value);
      const numero = Number($("#d-numero").value);
      const nombre = $("#d-tnombre").value.trim();
      if (!Number.isInteger(bloque) || bloque <= 0) throw new Error("Elige un bloque.");
      if (!Number.isInteger(numero) || numero < 0) throw new Error("El número de tema debe ser un entero (0 o más).");
      if (modo.id) await api("/api/temas/" + modo.id, "PUT", { bloque, numero, nombre });
      else await api("/api/temas", "POST", { bloque, numero, nombre });
    }
    $("#dlg").close();
    await cargar();
    nota(modo.tipo === "bloque" ? "Bloque guardado." : "Tema guardado.");
  } catch (err) { mostrarError(msg(err)); }
  finally { ok.disabled = false; }
});

/* ---------- Arranque ---------- */
cargar();

})();
