/* Serialización de preguntas al formato JSON del banco. Puro y sin Node: lo usa la API
   (también en el WebView) y el exportador de PC (`src/exportar.js`). */
const LETRAS = "abcdefgh";

/** Líneas JSON de una pregunta con el formato de los `tema_N.json` del banco (sangrado de 4 espacios). */
function lineasPregunta(q, { conTemario }) {
    const lineas = ["    {"];
    if (conTemario) {
        lineas.push('        "tema": ' + q.tema + ",");
        if (q.bloque != null) {
            lineas.push('        "bloque": ' + JSON.stringify(q.bloque_nombre ?? "") + ",");
            if (q.bloque_numero != null) lineas.push('        "bloque_numero": ' + q.bloque_numero + ",");
            lineas.push('        "tema_numero": ' + (q.tema_numero ?? q.tema) + ",");
        }
    }
    lineas.push('        "pregunta": ' + JSON.stringify(q.pregunta) + ",");
    if (q.id_externo) lineas.push('        "id_externo": ' + JSON.stringify(q.id_externo) + ",");
    lineas.push(
        '        "respuestas": [' + q.respuestas.map((r) => JSON.stringify(r)).join(", ") + "],",
        '        "respuesta_correcta": "' + LETRAS[q.correcta] + '",',
        '        "explicacion": ' + JSON.stringify(q.explicacion),
        "    }",
    );
    return lineas.join("\n");
}

function serializar(preguntas, opciones) {
    return "[\n" + preguntas.map((q) => lineasPregunta(q, opciones)).join(",\n") + "\n]\n";
}

/** Serializa preguntas con el formato antiguo (incluye tema/bloque para no perder el temario al reimportar). */
export function serializarJson(preguntas) {
    return serializar(preguntas, { conTemario: true });
}

/** Serializa las preguntas de un `tema_N.json` dentro de `bloque_X/`: los metadatos salen de la carpeta y de info.json. */
export function serializarTema(preguntas) {
    return serializar(preguntas, { conTemario: false });
}
