const LETRAS = "abcdefgh";

/** Serializa preguntas con el mismo formato (y sangrado) que los antiguos preguntas/*.json. */
export function serializarJson(preguntas) {
  const trozos = preguntas.map((q) => [
    "  {",
    '    "tema": ' + q.tema + ",",
    '    "pregunta": ' + JSON.stringify(q.pregunta) + ",",
    '    "respuestas": [' + q.respuestas.map((r) => JSON.stringify(r)).join(", ") + "],",
    '    "respuesta_correcta": "' + LETRAS[q.correcta] + '",',
    '    "explicacion": ' + JSON.stringify(q.explicacion),
    "  }",
  ].join("\n"));
  return "[\n" + trozos.join(",\n") + "\n]\n";
}
