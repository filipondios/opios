const LETRAS = "abcdefgh";

/** Serializa preguntas con el mismo formato (y sangrado) que los antiguos preguntas/*.json.
    Si la pregunta pertenece a un bloque, añade `bloque` y `tema_numero` para no perder el temario al reimportar. */
export function serializarJson(preguntas) {
  const trozos = preguntas.map((q) => {
    const lineas = [
      "  {",
      '    "tema": ' + q.tema + ",",
    ];
    if (q.bloque != null) {
      lineas.push('    "bloque": ' + JSON.stringify(q.bloque_nombre ?? "") + ",");
      lineas.push('    "tema_numero": ' + (q.tema_numero ?? q.tema) + ",");
    }
    lineas.push(
      '    "pregunta": ' + JSON.stringify(q.pregunta) + ",",
      '    "respuestas": [' + q.respuestas.map((r) => JSON.stringify(r)).join(", ") + "],",
      '    "respuesta_correcta": "' + LETRAS[q.correcta] + '",',
      '    "explicacion": ' + JSON.stringify(q.explicacion),
      "  }");
    return lineas.join("\n");
  });
  return "[\n" + trozos.join(",\n") + "\n]\n";
}
