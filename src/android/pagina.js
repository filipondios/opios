/* Preparación del HTML de una página para el WebView (task 11). Puro y sin DOM.
   En el WebView cada ruta se escribe en un documento nuevo (document.write) para que los
   módulos de página corran igual que en el servidor: sin listeners acumulados. Para eso hay
   que (1) refrescar el módulo de la página y (2) inyectar el shell, que vuelve a enganchar
   la navegación tras cada escritura (document.open borra el documento anterior). */

/** Añade `sufijo` a cada `src` de script y mete el shell antes de `</body>`. */
export function prepararPagina(html, sufijo) {
    const conModulos = html.replace(/(<script\b[^>]*\bsrc=")([^"]*)(")/g, (_, a, src, c) => a + src + sufijo + c);
    const shell = `<script type="module" src="/opios.js${sufijo}"></script>`;
    return conModulos.includes("</body>")
        ? conModulos.replace("</body>", shell + "</body>")
        : conModulos + shell;
}
