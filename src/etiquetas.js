/**
 * Etiqueta única de un tema: «Bloque · Tema N — nombre».
 * Acepta temas del temario, filas de /api/test y filas de estadísticas.
 * `bloque: false` omite el bloque (útil cuando ya está agrupado por bloque).
 */
export function etiquetaTema(t, { bloque = true, nombre = true } = {}) {
  const numero = t.numero ?? t.tema_numero ?? t.tema ?? t.id;
  const titulo = nombre ? (t.nombre ?? t.tema_nombre ?? "") : "";
  const nombreBloque = bloque ? (t.bloque_nombre ?? "") : "";
  const base = nombreBloque ? `${nombreBloque} · Tema ${numero}` : `Tema ${numero}`;
  return titulo ? `${base} — ${titulo}` : base;
}
