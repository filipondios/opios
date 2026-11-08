import { describe, expect, test } from "bun:test";

import { barajar } from "../public/js/comun.js";
import { etiquetaTema as etiquetaCliente } from "../public/js/etiquetas.js";
import { calcularResultado } from "../public/js/resultado.js";
import {
    estadoReloj,
    indiceOriginal,
    mmss,
    prepararPreguntas,
    respuestasParaGuardar,
} from "../public/js/simulacro-logica.js";

import { etiquetaTema as etiquetaServidor } from "../src/etiquetas.js";
import { hoyIso as hoyServidor, sumarDias as sumarServidor } from "../src/fechas.js";
import { hoyIso as hoyCliente, sumarDias as sumarCliente } from "../public/js/repaso.js";

const pregunta = (extra = {}) => ({
    id: 1,
    tema: 10,
    tema_numero: 1,
    tema_nombre: "Tema",
    bloque_nombre: "Bloque 1",
    pregunta: "¿Enunciado?",
    respuestas: ["A", "B", "C"],
    correcta: 1,
    explicacion: "Porque sí.",
    ...extra,
});

describe("barajar", () => {
    test("no muta la lista original y es determinista con azar inyectado", () => {
        const original = [0, 1, 2, 3];
        expect(barajar(original, () => 0)).toEqual([1, 2, 3, 0]);
        expect(original).toEqual([0, 1, 2, 3]);
    });

    test("con azar alto mantiene el orden", () => {
        expect(barajar([1, 2, 3], () => 0.999)).toEqual([1, 2, 3]);
    });
});

describe("calcularResultado", () => {
    const preguntas = [
        { tema: 1, temaNumero: 1, temaNombre: "Uno", bloque: "Bloque 1", correcta: 0 },
        { tema: 1, temaNumero: 1, temaNombre: "Uno", bloque: "Bloque 1", correcta: 2 },
        { tema: 2, temaNumero: 2, temaNombre: "Dos", bloque: "Bloque 2", correcta: 1 },
        { tema: 2, temaNumero: 2, temaNombre: "Dos", bloque: "Bloque 2", correcta: 0 },
    ];

    test("cuenta aciertos, fallos y blancos y aplica la penalización", () => {
        const res = calcularResultado(preguntas, [0, 1, null, 3], 1 / 3, 125);

        expect(res.total).toBe(4);
        expect(res.aciertos).toBe(1);
        expect(res.fallos).toBe(2);
        expect(res.blancos).toBe(1);
        expect(res.puntos).toBe(0.33);
        expect(res.nota).toBe(0.83);
        expect(res.segundos).toBe(125);

        expect(res.porTema).toHaveLength(2);
        expect(res.porTema[0]).toMatchObject({
            tema: 1,
            numero: 1,
            nombre: "Uno",
            bloque: "Bloque 1",
            total: 2,
            aciertos: 1,
            fallos: 1,
            blancos: 0,
        });
        expect(res.porTema[1]).toMatchObject({
            tema: 2,
            numero: 2,
            nombre: "Dos",
            bloque: "Bloque 2",
            total: 2,
            aciertos: 0,
            fallos: 1,
            blancos: 1,
        });
    });

    test("agrupa por id de tema y no por número: el Tema 1 de dos bloques no se mezcla", () => {
        const mismoNumero = [
            { tema: 10, temaNumero: 1, temaNombre: "Uno A", bloque: "Bloque 1", correcta: 0 },
            { tema: 10, temaNumero: 1, temaNombre: "Uno A", bloque: "Bloque 1", correcta: 1 },
            { tema: 20, temaNumero: 1, temaNombre: "Uno B", bloque: "Bloque 2", correcta: 0 },
        ];
        const res = calcularResultado(mismoNumero, [0, 1, 0], 0, 60);

        expect(res.porTema).toHaveLength(2);
        expect(res.porTema.map((t) => t.tema)).toEqual([10, 20]);
        expect(res.porTema[0].total).toBe(2);
        expect(res.porTema[1].total).toBe(1);
    });

    test("sin preguntas no divide entre cero", () => {
        const res = calcularResultado([], [], 1 / 3, 0);
        expect(res).toMatchObject({ total: 0, aciertos: 0, fallos: 0, blancos: 0, puntos: 0, nota: 0 });
        expect(res.porTema).toEqual([]);
    });
});

describe("prepararPreguntas", () => {
    test("baraja preguntas y opciones y guarda el índice original de cada opción", () => {
        const original = pregunta();
        const [q] = prepararPreguntas([original], { azar: () => 0 });

        expect(q.opciones).toEqual(["B", "C", "A"]);
        expect(q.originales).toEqual([1, 2, 0]);
        expect(q.correcta).toBe(0); // la correcta original (1) ahora está en la posición 0
        expect(q).toMatchObject({
            id: 1,
            tema: 10,
            temaNumero: 1,
            temaNombre: "Tema",
            bloque: "Bloque 1",
            explicacion: "Porque sí.",
        });
        expect(original.respuestas).toEqual(["A", "B", "C"]);
    });

    test("respeta el límite n después de barajar", () => {
        const q1 = pregunta({ id: 1 });
        const q2 = pregunta({ id: 2 });
        const res = prepararPreguntas([q1, q2], { n: 1, azar: () => 0 });
        expect(res).toHaveLength(1);
        expect(res[0].id).toBe(2); // con azar 0 la lista se invierte
    });

    test("dos bloques con el mismo número de tema siguen siendo temas distintos", () => {
        const a = pregunta({ id: 1, tema: 10, tema_nombre: "Tema A", bloque_nombre: "Bloque 1" });
        const b = pregunta({ id: 2, tema: 20, tema_nombre: "Tema B", bloque_nombre: "Bloque 2" });
        const res = prepararPreguntas([a, b], { azar: () => 0.999 });

        expect(res.map((q) => q.temaNumero)).toEqual([1, 1]);
        expect(res.map((q) => q.tema)).toEqual([10, 20]);
        expect(calcularResultado(res, [res[0].correcta, res[1].correcta], 0, 30).porTema).toHaveLength(2);
    });
});

describe("índice original y respuestas", () => {
    test("traduce la opción elegida al índice original", () => {
        const q = { originales: [2, 0, 1] };
        expect(indiceOriginal(q, 0)).toBe(2);
        expect(indiceOriginal(q, 1)).toBe(0);
        expect(indiceOriginal(q, 2)).toBe(1);
        expect(indiceOriginal(q, null)).toBe(-1);
        expect(indiceOriginal(q, -1)).toBe(-1);
        expect(indiceOriginal(q, 9)).toBe(-1);
    });

    test("prepara las respuestas en el formato del servidor", () => {
        const preguntas = [
            { id: 7, originales: [2, 0, 1] },
            { id: 8, originales: [1, 0] },
        ];
        expect(respuestasParaGuardar(preguntas, [2, null])).toEqual([
            { id: 7, elegida: 1 },
            { id: 8, elegida: -1 },
        ]);
    });
});

describe("reloj del simulacro", () => {
    test("redondea hacia arriba y marca los últimos cinco minutos", () => {
        expect(estadoReloj(1000, 0)).toEqual({ restante: 1000, segundos: 1, agotado: false, bajo: true });
        expect(estadoReloj(300_000, 0)).toMatchObject({ segundos: 300, agotado: false, bajo: true });
        expect(estadoReloj(300_001, 0)).toMatchObject({ segundos: 301, agotado: false, bajo: false });
        expect(estadoReloj(0, 0)).toEqual({ restante: 0, segundos: 0, agotado: true, bajo: true });
        expect(estadoReloj(-500, 0)).toEqual({ restante: 0, segundos: 0, agotado: true, bajo: true });
    });

    test("formatea MM:SS", () => {
        expect(mmss(0)).toBe("00:00");
        expect(mmss(65)).toBe("01:05");
        expect(mmss(3599)).toBe("59:59");
        expect(mmss(3600)).toBe("60:00");
        expect(mmss(-5)).toBe("00:00");
        expect(mmss(59.6)).toBe("01:00");
    });
});

describe("fechas: cliente y servidor en sintonía", () => {
    const fechas = [
        new Date(2026, 0, 1, 0, 0),
        new Date(2026, 2, 10, 23, 59),
        new Date(2024, 1, 29, 12, 0),
        new Date(2026, 11, 31, 23, 59),
    ];

    test("hoyIso coincide en ambos lados", () => {
        for (const fecha of fechas) expect(hoyCliente(fecha)).toBe(hoyServidor(fecha));
    });

    test("sumarDias coincide en ambos lados, incluidos meses, años y bisiestos", () => {
        const casos = [
            ["2026-03-10", 1],
            ["2026-03-31", 1],
            ["2026-12-31", 1],
            ["2024-02-28", 1],
            ["2024-02-29", 1],
            ["2026-01-01", -1],
            ["2026-03-10", 35],
            ["2026-03-10", -35],
        ];
        for (const [fecha, dias] of casos) {
            expect(sumarCliente(fecha, dias)).toBe(sumarServidor(fecha, dias));
        }
    });
});

describe("etiquetaTema: cliente y servidor en sintonía", () => {
    const filas = [
        { bloque_nombre: "Bloque II", numero: 3, nombre: "Constitución" },
        { bloque_nombre: "Bloque 1", tema_numero: 1, tema_nombre: "Procedimiento" },
        { bloque_nombre: "Bloque 1", tema: 7, tema_nombre: "Sin número" },
        { bloque_nombre: "", numero: 2, nombre: "" },
    ];

    test("produce el mismo texto con y sin bloque o nombre", () => {
        for (const fila of filas) {
            expect(etiquetaCliente(fila)).toBe(etiquetaServidor(fila));
            expect(etiquetaCliente(fila, { bloque: false })).toBe(etiquetaServidor(fila, { bloque: false }));
            expect(etiquetaCliente(fila, { nombre: false })).toBe(etiquetaServidor(fila, { nombre: false }));
        }
    });
});
