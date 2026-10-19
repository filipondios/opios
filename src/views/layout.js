import { html } from "./html.js";

/**
 * Plantilla base de todas las páginas.
 * `enlace` es el botón de cabecera hacia la otra página: { href, texto }.
 */
export function layout({ titulo, marca, enlace, estado, ancho = false, css = [], js = [], cuerpo }) {
  return html`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${titulo}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap">
<link rel="stylesheet" href="/css/base.css">
${css.map((c) => html`<link rel="stylesheet" href="/css/${c}">`)}
</head>
<body>
<div class="wrap${ancho ? " wide" : ""}">
  <header class="top">
    <span class="brand">${marca}</span>
    <div class="top-right">
      <a class="btn small" href="${enlace.href}">${enlace.texto}</a>
      <span class="status" id="status" data-state="ok" role="status">${estado}</span>
    </div>
  </header>
${cuerpo}
</div>
${js.map((s) => html`<script src="/js/${s}" defer></script>`)}
</body>
</html>
`;
}
