/* Task 11: preparación del HTML para el WebView (src/android/pagina.js). */
import { describe, expect, test } from "bun:test";

import { prepararPagina } from "../src/android/pagina.js";

const PAGINA = `<!doctype html>
<html><head><link rel="stylesheet" href="/css/base.css"></head>
<body><main id="app"></main>
<script type="module" src="/js/test.js"></script>
</body></html>`;

describe("prepararPagina", () => {
    const salida = prepararPagina(PAGINA, "?r=1");

    test("refresca el módulo de la página y no toca los estáticos", () => {
        expect(salida).toContain('src="/js/test.js?r=1"');
        expect(salida).toContain('href="/css/base.css"'); // los enlaces no se cachean
    });

    test("inyecta el shell justo antes de </body>", () => {
        expect(salida).toContain('<script type="module" src="/opios.js?r=1"></script></body>');
    });

    test("sin </body> el shell se añade al final (no se pierde)", () => {
        const html = prepararPagina("<main>hola</main>", "?r=2");
        expect(html.endsWith('<script type="module" src="/opios.js?r=2"></script>')).toBe(true);
    });
});
