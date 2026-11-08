# Estructura del banco de preguntas

El banco es un directorio con un subdirectorio por bloque (por defecto `./preguntas`, o `./ejemplo/` si no existe):

```
preguntas/
  bloque_1/
    info.json      nombre del bloque y títulos de los temas
    tema_1.json    preguntas del tema 1
    tema_2.json    preguntas del tema 2
    ...
  bloque_2/
    ...
  examenes/        material propio que no se importa (opcional)
```

- Cada directorio `bloque_N/` define un bloque, y `N` es su número estable.
- `info.json` contiene el nombre del bloque y los títulos de sus temas.
- Cada `tema_N.json` contiene las preguntas del tema `N` de ese bloque.
- Los directorios `generated/` y `examenes/` se ignoran; solo se importan los archivos `bloque_N/tema_N.json`.
- `generated/` puede conservar las preguntas creadas con un modelo para saber de dónde salieron; su contenido no se importa.

`info.json`:

```json
{
  "nombre": "Bloque 1. El Estado",
  "temas": [
    { "numero": 1, "titulo": "La Constitución" }
  ]
}
```

Cada `tema_N.json` es un array de preguntas:

```json
[
  {
    "pregunta": "¿Qué Título de la Constitución regula el Gobierno?",
    "respuestas": ["Título V", "Título IV", "Título VI", "Título III"],
    "respuesta_correcta": "b",
    "explicacion": "Título IV, artículos 97 a 107.",
    "id_externo": "6f0c2f0e-..."
  }
]
```

`id_externo` es opcional pero recomendable: permite editar una pregunta y ejecutar `bun run seed --actualizar` sin duplicarla ni perder su progreso. `bun run ids` lo añade automáticamente.

El número del directorio fija el bloque y el nombre del archivo fija el número del tema. Para ampliar el banco, añade más directorios `bloque_N/` con sus archivos `info.json` y `tema_N.json`. Los límites de validación y un prompt de ejemplo para generar preguntas están en [`formato-preguntas.md`](formato-preguntas.md).
