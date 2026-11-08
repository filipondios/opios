# Formato del banco de preguntas

La aplicación lee un directorio de preguntas cuya ruta se configura con `OPIOS_PREGUNTAS` (por defecto `./preguntas` y, si no existe, el ejemplo `./ejemplo/`). Este documento describe la estructura de ese directorio y el formato de cada archivo.

## Estructura

```
banco/
  bloque_1/
    info.json      nombre del bloque y títulos de sus temas
    tema_1.json    preguntas del tema 1
    tema_2.json    preguntas del tema 2
    generated/     material auxiliar; no se importa
  bloque_2/
    info.json
    tema_1.json
  examenes/        material propio; no se importa
```

- La carpeta `bloque_N/` define el número estable del bloque. El nombre visible sale de `info.json`.
- `tema_N.json` define el tema `N` dentro del bloque y contiene solo preguntas.
- `generated/` y `examenes/` no se recorren: sirven para conservar material de apoyo.
- No se admiten carpetas `bloque_N` anidadas ni archivos de preguntas en la raíz salvo el formato antiguo (con aviso de obsolescencia).

## `info.json`

Cada bloque puede declarar su nombre y los títulos de sus temas:

```json
{
  "nombre": "Bloque 1. Geografía",
  "temas": [
    { "numero": 1, "titulo": "Geografía física" },
    { "numero": 2, "titulo": "Geografía política" }
  ]
}
```

- `nombre` es obligatorio y no puede superar los 120 caracteres.
- Cada tema necesita un `numero` entero y único dentro del bloque, y un `titulo` no vacío de hasta 500 caracteres.
- Un tema declarado sin archivo `tema_N.json` se crea vacío (la validación lo muestra como aviso).
- Un archivo `tema_N.json` que no aparece en `info.json` se importa igualmente, con un aviso.
- Si no hay `info.json`, el bloque se llama «Bloque N» y queda editable desde `/temario`.
- Los bloques con `info.json` son de solo lectura en la interfaz: un `seed` posterior vuelve a aplicar sus nombres y títulos.

## Formato de una pregunta

Cada `tema_N.json` es un array de objetos:

```json
[
  {
    "pregunta": "¿Cuál es el río más caudaloso del mundo?",
    "respuestas": ["El Amazonas", "El Misisipi", "El Nilo", "El Volga"],
    "respuesta_correcta": "a",
    "explicacion": "El Amazonas es el río con mayor caudal del planeta.",
    "id_externo": "ejemplo-b1t1-01"
  }
]
```

| Campo | Obligatorio | Descripción |
|---|---|---|
| `pregunta` | Sí | Enunciado, hasta 2000 caracteres. |
| `respuestas` | Sí | Entre 2 y 8 opciones, cada una de hasta 1000 caracteres. |
| `respuesta_correcta` | No | Letra de la opción correcta (`a` a `h`, sin distinguir mayúsculas). Si falta, se asume `a`. También se acepta el texto exacto de una opción. |
| `explicacion` | No | Texto que se muestra al fallar, hasta 4000 caracteres. |
| `id_externo` | No | Identificador estable de hasta 200 caracteres. Permite actualizar la pregunta con `bun run seed --actualizar` conservando su id, su progreso y sus respuestas registradas. Debe ser único. |

Notas:

- Los archivos pueden ser un array o un objeto `{ "preguntas": [...] }`.
- La deduplicación usa el enunciado normalizado (sin tildes, mayúsculas ni puntuación): dos preguntas que solo difieran en eso se consideran la misma.
- Las opciones deben ser distintas entre sí. La importación es tolerante con datos antiguos, pero el creador rechaza duplicados.
- Evita opciones que dependan del orden, como «todas las anteriores» o «a y b»: las opciones se barajan al mostrarlas. La importación avisa si las detecta.
- Procura que la opción correcta no sea siempre la más larga; `bun run calidad` mide ese sesgo.

## Validar el banco

```bash
bun run validar                 # valida ./preguntas (o ./ejemplo si no existe)
bun run validar ./opios-bank
```

El comando importa el banco en una base de datos en memoria, así que no toca tu progreso. Lista los errores que invalidan el banco y los avisos que conviene revisar (temas sin archivo, duplicados, sesgo de longitud). Sale con código 1 si hay errores, lo que permite usarlo en integración continua.

Ejemplo de flujo de CI para el repositorio del banco, que descarga la app y valida el banco:

```yaml
name: validar-banco
on: [push, pull_request]
jobs:
  validar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: git clone --depth 1 https://github.com/<usuario>/opios.git app
      - run: bun run validar ../   # desde app/, apuntando al checkout del banco
        working-directory: app
```

Ajusta las rutas según cómo queden los dos repositorios en el runner.

## Prompt de ejemplo para generar preguntas

Puedes pedir a un modelo de lenguaje un primer borrador. Revísalo siempre a mano: los modelos inventan datos, repiten opciones y tienden a alargar la respuesta correcta.

```text
Genera 10 preguntas tipo test sobre <TEMA>, en español, con este formato JSON:

[
  {
    "pregunta": "Enunciado claro y autónomo, sin referencias a 'el texto anterior'.",
    "respuestas": ["Opción A", "Opción B", "Opción C", "Opción D"],
    "respuesta_correcta": "b",
    "explicacion": "Una o dos frases que justifiquen la respuesta correcta."
  }
]

Requisitos:
- Exactamente 4 opciones por pregunta.
- Una sola respuesta correcta y tres distractores verosímiles.
- Longitudes de opción parecidas: no hagas que la correcta sea la más larga.
- No uses opciones como "todas las anteriores" ni "ninguna de las anteriores".
- Varía la posición de la respuesta correcta entre a, b, c y d.
- No repitas enunciados ni opciones entre preguntas.
- Devuelve solo el array JSON, sin texto adicional.
```

Después de generar el borrador:

1. Revisa cada dato y cada explicación contra una fuente fiable.
2. Ajusta los distractores para que no delaten la respuesta.
3. Añade `id_externo` a cada pregunta (`bun run ids` puede asignarlo).
4. Ejecuta `bun run validar` y corrige los errores y avisos.