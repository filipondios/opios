import { describe, expect, test } from "bun:test";
import { aTexto } from "../src/views/html.js";
import { anillo, barraApilada, columnas, linea, mapaCalor } from "../src/views/graficos.js";

const svg = (r) => aTexto(r);
const tieneSvg = (html) => html.includes("<svg") && html.includes('role="img"');

describe("gráficos SVG de servidor (Fase 1.4)", () => {
    test("los estados vacíos no generan SVG roto", () => {
        expect(svg(barraApilada({ total: 0 }))).toContain('class="empty"');
        expect(svg(columnas({ datos: [] }))).toContain('class="empty"');
        expect(svg(mapaCalor({ datos: [] }))).toContain('class="empty"');
        expect(svg(linea({ puntos: [] }))).toContain('class="empty"');
        expect(svg(anillo({ total: 0 }))).toContain('class="empty"');
        for (const html of [
            svg(barraApilada({ total: 0 })),
            svg(columnas({ datos: [] })),
            svg(mapaCalor({ datos: [] })),
            svg(linea({ puntos: [] })),
            svg(anillo({ total: 0 })),
        ])
            expect(html).not.toContain("<svg");
    });

    test("la barra apilada reparte el total y lo expone como texto accesible", () => {
        const html = svg(barraApilada({ dominadas: 2, aprendiendo: 1, nuevas: 1, total: 4 }));
        expect(html).toContain('role="img"');
        expect(html).toContain("2 dominadas, 1 en aprendizaje, 1 nuevas de 4");
        expect(html).toContain('class="b-ok"');
        expect(html).toContain('class="b-mid"');
        expect(html).toContain('class="b-new"');
    });

    test("columnas con un solo dato, ceros y valores extremos no producen NaN", () => {
        const uno = svg(columnas({ datos: [{ etiqueta: "Hoy", valor: 3 }], id: "uno" }));
        expect(uno).toContain("<title");
        expect(uno).toContain("<desc");
        expect(uno).not.toContain("NaN");
        const extremos = svg(
            columnas({
                datos: [
                    { etiqueta: "Cero", valor: 0 },
                    { etiqueta: "Grande", valor: 999999 },
                    { etiqueta: "Negativo", valor: -5 },
                    { etiqueta: "Texto", valor: "no" },
                ],
                id: "extremos",
            }),
        );
        expect(extremos).not.toContain("NaN");
        expect(extremos).toContain(">999999<");
        expect(extremos).toContain(">0<");
    });

    test("el mapa de calor pinta 12 semanas completas y marca los valores", () => {
        const html = svg(
            mapaCalor({
                datos: [{ fecha: "2026-11-09", valor: 4 }],
                hoy: "2026-11-09",
                semanas: 12,
                id: "actividad",
            }),
        );
        expect(tieneSvg(html)).toBe(true);
        expect((html.match(/class="calor-celda"/g) ?? []).length).toBe(12 * 7);
        expect(html).toContain("<title>2026-11-09: 4</title>");
        expect(html).toContain("2026-08-18");
        expect(html).toContain("2026-11-09");
    });

    test("la línea distingue un punto de una serie y no dibuja trazos vacíos", () => {
        const uno = svg(linea({ puntos: [{ etiqueta: "Hoy", valor: 75 }], id: "uno" }));
        expect(uno).toContain("<circle");
        expect(uno).not.toContain("<polyline");
        const dos = svg(
            linea({
                puntos: [
                    { etiqueta: "Semana 1", valor: 40 },
                    { etiqueta: "Semana 2", valor: 80 },
                ],
                maximo: 100,
                id: "dos",
            }),
        );
        expect(dos).toContain("<polyline");
        expect((dos.match(/<circle/g) ?? []).length).toBe(2);
        expect(dos).not.toContain("NaN");
    });

    test("el anillo recorta los valores fuera de rango y muestra el porcentaje", () => {
        const html = svg(anillo({ valor: 50, total: 20, titulo: "Dominio", id: "dominio" }));
        expect(html).toContain("20 de 20 (100 %)");
        expect(html).toContain('stroke-dashoffset="0"');
        expect(html).toContain("100 %");
        const negativo = svg(anillo({ valor: -5, total: 10, id: "negativo" }));
        expect(negativo).toContain("0 de 10 (0 %)");
        expect(negativo).not.toContain("NaN");
    });

    test("las etiquetas se escapan y los datos raros no rompen el SVG", () => {
        const html = svg(
            columnas({
                datos: [{ etiqueta: "<script>alert(1)</script>", valor: 1 }],
                titulo: 'Título "con comillas"',
                id: "escape",
            }),
        );
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(html).toContain("Título &quot;con comillas&quot;");
    });
});
