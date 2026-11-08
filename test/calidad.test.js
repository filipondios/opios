import { describe, expect, test } from "bun:test";
import { analizarPreguntas } from "../src/calidad.js";

describe("análisis de calidad del banco", () => {
    test("detecta la correcta como única opción más larga", () => {
        const larga = "Una opción claramente más larga";
        const r = analizarPreguntas([
            { pregunta: "Sesgada", respuestas: ["Sí", larga, "No", "Quizá"], respuesta_correcta: "b" },
            {
                pregunta: "Equilibrada",
                respuestas: ["Opción uno", "Opción dos", "Opción tres", "Opción cuatro"],
                respuesta_correcta: "a",
            },
        ]);
        expect(r.n).toBe(2);
        expect(r.unicaLarga).toBe(1);
        expect(r.masLargaEmpate).toBe(1);
        expect(r.sesgadas).toHaveLength(1);
        expect(r.sesgadas[0]).toMatchObject({
            indice: 0,
            correcta: 1,
            longitudCorrecta: larga.length,
            longitudMaxima: larga.length,
        });
        expect(r.posiciones.slice(0, 4)).toEqual([1, 1, 0, 0]);
    });

    test("un empate en la longitud máxima no cuenta como sesgo único", () => {
        const r = analizarPreguntas([
            {
                pregunta: "Empate",
                respuestas: ["Respuesta A", "Respuesta B", "Corta", "Muy corta"],
                respuesta_correcta: "a",
            },
        ]);
        expect(r.unicaLarga).toBe(0);
        expect(r.masLargaEmpate).toBe(1);
        expect(r.sesgadas).toEqual([]);
    });

    test("acepta el índice interno `correcta` y no rompe con listas vacías", () => {
        const r = analizarPreguntas([
            { pregunta: "Índice", respuestas: ["Corta", "La respuesta correcta es esta"], correcta: 1 },
        ]);
        expect(r.sesgadas[0]).toMatchObject({ correcta: 1 });
        expect(analizarPreguntas([])).toMatchObject({ n: 0, unicaLarga: 0, sesgadas: [] });
    });
});
