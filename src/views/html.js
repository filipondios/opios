/* Motor de plantillas mínimo: template literals con escapado automático.
   html`<p>${texto}</p>` escapa `texto`; los resultados de otro html`` (o raw()) se insertan tal cual;
   los arrays se concatenan; null, undefined y false no producen nada. */
const RAW = Symbol("raw");
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const raw = (s) => ({ [RAW]: true, s: String(s) });

function valor(v) {
  if (v == null || v === false) return "";
  if (Array.isArray(v)) return v.map(valor).join("");
  if (typeof v === "object" && v[RAW]) return v.s;
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function html(textos, ...valores) {
  let out = textos[0];
  valores.forEach((v, i) => { out += valor(v) + textos[i + 1]; });
  return raw(out);
}

export const aTexto = (r) => r.s;
