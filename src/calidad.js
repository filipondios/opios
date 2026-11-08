/* Análisis de calidad del banco: sesgo de longitud y posición de la respuesta correcta.
   Es lógica pura (sin FS) para poder probarla; el recorrido de archivos vive en scripts/calidad.js. */

const LETRAS = "abcdefgh";
const texto = (v) => String(v ?? "").trim();

/**
 * Analiza una lista de preguntas en formato JSON (`respuestas`, `respuesta_correcta` o `correcta`).
 * Devuelve recuentos, distribución de posiciones y las preguntas donde la correcta es la única más larga.
 */
export function analizarPreguntas(preguntas) {
    const n = preguntas.length;
    const posiciones = Array(8).fill(0);
    let unicaLarga = 0,
        masLargaEmpate = 0,
        diferencia = 0,
        ratio = 0;
    const sesgadas = [];

    preguntas.forEach((p, indice) => {
        const opciones = (Array.isArray(p.respuestas) ? p.respuestas : []).map(texto);
        if (!opciones.length) return;
        const declarada = Number.isInteger(p.correcta)
            ? p.correcta
            : LETRAS.indexOf(String(p.respuesta_correcta ?? "a").toLowerCase());
        const correcta = declarada >= 0 && declarada < opciones.length ? declarada : 0;
        if (correcta < posiciones.length) posiciones[correcta]++;

        const largos = opciones.map((o) => o.length);
        const maxima = Math.max(...largos);
        const cuantasMaximas = largos.filter((l) => l === maxima).length;
        const largoCorrecta = largos[correcta];
        const esMasLarga = largoCorrecta === maxima;

        if (esMasLarga) masLargaEmpate++;
        if (esMasLarga && cuantasMaximas === 1) {
            unicaLarga++;
            sesgadas.push({
                indice,
                pregunta: p.pregunta,
                opciones,
                correcta,
                longitudCorrecta: largoCorrecta,
                longitudMaxima: maxima,
            });
        }

        const otras = largos.filter((_, i) => i !== correcta);
        const mediaOtras = otras.reduce((a, b) => a + b, 0) / Math.max(1, otras.length);
        diferencia += largoCorrecta - mediaOtras;
        ratio += largoCorrecta / Math.max(1, mediaOtras);
    });

    return {
        n,
        unicaLarga,
        masLargaEmpate,
        posiciones,
        diferenciaMedia: n ? diferencia / n : 0,
        ratioMedio: n ? ratio / n : 0,
        sesgadas,
    };
}
