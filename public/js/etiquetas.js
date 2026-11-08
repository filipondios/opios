/* Etiqueta única de tema (cliente). Mantener en sintonía con src/etiquetas.js. */

export function etiquetaTema(t, opciones) {
  if (!t) return "";
  const o = opciones || {};
  const bloque = o.bloque === false ? "" : t.bloque_nombre || "";
  const numero = t.numero ?? t.tema_numero ?? t.tema ?? t.id;
  const titulo = o.nombre === false ? "" : t.nombre || t.tema_nombre || "";
  const base = bloque ? bloque + " · Tema " + numero : "Tema " + numero;
  return titulo ? base + " — " + titulo : base;
}
