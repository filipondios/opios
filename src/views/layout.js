import { html } from "./html.js";

/**
 * Plantilla base de todas las páginas.
 * `enlace` es el botón de cabecera hacia la otra página: { href, texto }.
 * `enlaces` permite varios botones; si se indica, tiene prioridad sobre `enlace`.
 * `jsModulo` carga los scripts con `type="module"` (necesario si usan `import`).
 */
export function layout({ titulo, marca, enlace, enlaces, estado, ancho = false, css = [], js = [], jsModulo = false, cuerpo }) {
  const botones = enlaces ?? (enlace ? [enlace] : []);
  return html`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${titulo}</title>
<link rel="stylesheet" href="/css/base.css">
${css.map((c) => html`<link rel="stylesheet" href="/css/${c}">`)}
</head>
<body>
<div class="wrap${ancho ? " wide" : ""}">
  <header class="top">
    <span class="brand">${marca}</span>
    <div class="top-right">
      ${botones.map((b) => html`<a class="btn small" href="${b.href}">${b.texto}</a>`)}
      <span class="status" id="status" data-state="ok" role="status">${estado}</span>
    </div>
  </header>
${cuerpo}
</div>
${js.map((s) => jsModulo
  ? html`<script type="module" src="/js/${s}"></script>`
  : html`<script src="/js/${s}" defer></script>`)}
</body>
</html>
`;
}
