/* Cálculo del resultado de un simulacro. Lógica pura, sin DOM, para poder probarla. */

/**
 * Agrupa por id de tema (no por número): el Tema 1 de dos bloques son temas distintos.
 * `preguntas`: [{ tema, temaNumero, temaNombre, bloque, correcta }]
 * `respuestas`: índice elegido por pregunta (null = en blanco)
 */
export function calcularResultado(preguntas, respuestas, penalizacion, segundos) {
    let aciertos = 0,
        fallos = 0,
        blancos = 0;
    const porTema = new Map();
    preguntas.forEach((q, i) => {
        const r = respuestas[i];
        let estado;
        if (r == null) {
            blancos++;
            estado = "blanco";
        } else if (r === q.correcta) {
            aciertos++;
            estado = "acierto";
        } else {
            fallos++;
            estado = "fallo";
        }
        const clave = q.tema;
        const t = porTema.get(clave) ?? {
            tema: clave,
            numero: q.temaNumero,
            nombre: q.temaNombre,
            bloque: q.bloque,
            total: 0,
            aciertos: 0,
            fallos: 0,
            blancos: 0,
        };
        t.total++;
        t[estado === "acierto" ? "aciertos" : estado === "fallo" ? "fallos" : "blancos"]++;
        porTema.set(clave, t);
    });
    const total = preguntas.length;
    const puntos = Math.round((aciertos - fallos * penalizacion) * 100) / 100;
    const nota = total ? Math.round((puntos / total) * 1000) / 100 : 0;
    return {
        total,
        aciertos,
        fallos,
        blancos,
        puntos,
        nota,
        segundos,
        porTema: [...porTema.values()].sort(
            (a, b) => String(a.bloque).localeCompare(String(b.bloque), "es") || a.numero - b.numero || a.tema - b.tema,
        ),
    };
}
