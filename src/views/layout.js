import { html } from "./html.js";

/** Menú único de la aplicación. `actual` marca la página activa con aria-current. */
const PAGINAS = [
    { id: "test", href: "/", texto: "Test" },
    { id: "simulacro", href: "/simulacro", texto: "Simulacro" },
    { id: "estadisticas", href: "/estadisticas", texto: "Estadísticas" },
    { id: "maker", href: "/maker", texto: "Maker" },
    { id: "temario", href: "/temario", texto: "Temario" },
    { id: "biblioteca", href: "/biblioteca", texto: "Bancos" },
];

/**
 * Plantilla base de todas las páginas.
 * `actual` es el id de la página en el menú (test, simulacro, estadisticas, maker, temario).
 * Los scripts indicados en `js` se cargan como módulos ESM.
 */
export function layout({ titulo, actual = null, estado, estadoTipo = "ok", ancho = false, css = [], js = [], cuerpo }) {
    return html`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Opios: ${titulo}</title>
<link rel="icon" href="/logo.png" type="image/png">
<link rel="stylesheet" href="/css/base.css">
${css.map((c) => html`<link rel="stylesheet" href="/css/${c}">`)}
<script>try{var t=localStorage.getItem("opios.tema");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body>
<div class="wrap${ancho ? " wide" : ""}">
  <header class="top">
    <a class="brand" href="/">Opios</a>
    <a class="banco-actual" href="/biblioteca" id="banco-actual" hidden></a>
    <nav class="top-nav" aria-label="Principal">
      ${PAGINAS.map((p) => html`<a href="${p.href}"${p.id === actual ? html` aria-current="page"` : ""}>${p.texto}</a>`)}
    </nav>
    <div class="top-right">
      <button class="btn small theme" type="button" id="btn-tema" aria-label="Cambiar a tema oscuro" aria-pressed="false" title="Cambiar tema claro/oscuro">
        <svg aria-hidden="true" id="tema-icono-luna" viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>
        <svg aria-hidden="true" id="tema-icono-sol" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>
        <span id="tema-texto">Oscuro</span>
      </button>
      <span class="status" id="status" data-state="${estadoTipo}" role="status" title="${estado}"><span class="status-text">${estado}</span></span>
    </div>
  </header>
${cuerpo}
</div>
${js.map((s) => html`<script type="module" src="/js/${s}"></script>`)}
<script src="/js/tema.js" defer></script>
<script type="module" src="/js/actualizaciones.js"></script>
</body>
</html>
`;
}
