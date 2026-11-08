<p align="center">
  <img src="public/logo.png" alt="opios" width="150">
</p>

<h1 align="center">opios</h1>

<p align="center"><em>Un entrenador en local para exámenes tipo test, con repaso espaciado.</em></p>

opios es una pequeña aplicación autoalojada para estudiar bancos de preguntas de oposiciones. Organizas las preguntas por bloques y temas, y luego practicas con tests libres, simulacros cronometrados y repasos programados. Funciona íntegramente en tu máquina con Bun y SQLite: sin cuentas, sin nube y sin dependencias externas.

La aplicación es una herramienta genérica: no incluye ningún banco de preguntas. Lee un directorio configurable (por defecto `./preguntas`, o el banco de ejemplo `./ejemplo/` si no existe) y trae ese ejemplo para que puedas probarla nada más clonarla. Se creó para preparar las oposiciones al [Cuerpo de Técnicos Auxiliares de Informática de la Administración del Estado](https://www.inap.es/es/seleccion/procesos-selectivos-de-cuerposescalas-generales/cuerpo-de-tecnicos-auxiliares-de-informatica-de-la-administracion-del-estado/que-es-el-cuerpo-de-tecnicos-auxiliares-de-informatica-de-la-administracion-del-estado) (España), cuyo banco vive en un repositorio aparte; la estructura de bloques y temas sirve para cualquier otro temario.

- Tests libres que combinan preguntas nuevas con repasos pendientes.
- Simulacros cronometrados con penalización opcional y posibilidad de reanudarlos.
- Programación con repaso espaciado y un cupo diario de preguntas nuevas.
- Estadísticas: progreso por tema, previsión de repasos, acierto semanal, racha, tiempo medio y preguntas más falladas.
- Interfaz accesible y cómoda en móvil: menú común, tema claro/oscuro, opciones con radios reales y respuesta al primer toque.
- Todo en local: tu banco y tu progreso viven en un único archivo SQLite.

## Inicio rápido

Solo necesitas [Bun](https://bun.sh); no hay paquetes que instalar.

```bash
bun run seed   # importa el banco (./preguntas si existe; si no, ./ejemplo) en data/opios.db
bun start      # abre http://127.0.0.1:8000
bun test
```

En el primer arranque, si la base de datos está vacía, el banco se importa automáticamente. `bun run dev` arranca el servidor en modo vigilancia.

Para mantener el banco:

```bash
bun run validar                 # comprueba un banco (formato, avisos, sesgo) sin tocar tu base de datos
bun run calidad                 # sesgo de la opción más larga y posición de la correcta
bun run calidad --lista         # muestra las preguntas sesgadas con sus opciones
bun run ids                     # asigna id_externo estable a las preguntas que no lo tengan
bun run seed --actualizar       # actualiza preguntas editadas conservando su id y progreso
```

`bun run calidad` incluye `generated/` (marcado con `*`), aunque esas preguntas no se importan: solo dejan constancia de su procedencia. Usa `--umbral N` para cambiar el umbral (30 % por defecto) y `--fallar` para que el comando salga con error si algún archivo lo supera.

## Usar tu propio banco

La app lee las preguntas de un directorio externo, así que tu banco puede vivir en su propio repositorio (por ejemplo, `opios-bank`) sin arrastrar el código de la aplicación.

- **`OPIOS_PREGUNTAS`**: ruta del banco. Si no la defines, se usa `./preguntas` cuando existe y, si no, el ejemplo `./ejemplo/`. Si la defines y la carpeta no existe, la app avisa y no arranca (no cae al ejemplo en silencio).
- **`OPIOS_SEED`**: cuándo importar al arrancar. `vacia` (por defecto) solo importa si la base de datos no tiene preguntas; `auto` importa en cada arranque (actualizando por `id_externo` para no duplicar); `no` no importa nunca.
- **`.env`**: Bun lo carga automáticamente. Copia [`.env.example`](.env.example) y ajusta la ruta, por ejemplo `OPIOS_PREGUNTAS=./opios-bank`.

Flujo típico:

```bash
git clone https://github.com/<usuario>/opios-bank opios-bank
echo "OPIOS_PREGUNTAS=./opios-bank" > .env
bun run seed      # importa tu banco
bun start
```

Con Docker, `docker-compose.yml` monta el banco como volumen de solo lectura y publica el puerto solo en loopback:

```bash
docker compose up --build
```

El formato de los archivos se detalla en [`docs/formato-preguntas.md`](docs/formato-preguntas.md), que incluye un prompt de ejemplo para generar preguntas con un modelo de lenguaje.

## Copias de seguridad

```bash
bun run backup                      # data/opios-YYYYMMDD-HHMMSS.db (incluye el progreso)
bun run backup copia.db             # escribe en un archivo concreto
bun run export copia.json           # formato JSON antiguo (solo preguntas)
bun run export --por-bloques copia/ # bloque_X/info.json + tema_N.json
```

Para restaurar una copia, para la aplicación y copia el archivo sobre `data/opios.db`, o arranca con `OPIOS_DB=copia.db`.

## Estructura del banco de preguntas

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

El número del directorio fija el bloque y el nombre del archivo fija el número del tema. Para ampliar el banco, añade más directorios `bloque_N/` con sus archivos `info.json` y `tema_N.json`. Los límites de validación y un prompt de ejemplo para generar preguntas están en [`docs/formato-preguntas.md`](docs/formato-preguntas.md).

## Configuración

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `OPIOS_PREGUNTAS` | `./preguntas` si existe, si no `./ejemplo` | Directorio del banco de preguntas |
| `OPIOS_SEED` | `vacia` | Cuándo importar al arrancar: `vacia`, `auto` o `no` |
| `PORT` | `8000` | Puerto |
| `HOST` | `127.0.0.1` | Interfaz en la que escuchar |
| `OPIOS_DB` | `data/opios.db` | Ruta de la base de datos |
| `APP_TZ` | zona horaria del sistema | Zona horaria usada para calcular "hoy" (por ejemplo `Europe/Madrid`) |
| `AUTH_USER` + `AUTH_PASS` | - | Autenticación básica HTTP cuando se definen ambas |
| `ALLOWED_HOSTS` | solo loopback | Valores de `Host` adicionales que aceptar, separados por comas (`localhost` y `127.0.0.1` siempre funcionan) |

Los límites diarios (15 preguntas nuevas al día, el freno de repasos atrasados) y el factor que acorta los intervalos según se acerca el examen son constantes de `src/config.js` (`CUPO_NUEVAS`, `FRENO_ATRASO`, `FACTOR_EXAMEN`).

### Docker

```bash
docker build -t opios .
docker run -d -p 10000:10000 -v opios-data:/data \
  -e AUTH_USER=usuario -e AUTH_PASS=clave opios
```

La imagen no incluye tu banco: trae el de ejemplo y, si montas el tuyo con `OPIOS_PREGUNTAS`, lo importa. [`docker-compose.yml`](docker-compose.yml) deja listo el montaje del banco como volumen de solo lectura y el puerto publicado únicamente en loopback.

El contenedor se ejecuta con el usuario `bun` y, por defecto, solo acepta cabeceras `Host` de loopback. Si accedes a él por la LAN, añade tu dirección con `-e ALLOWED_HOSTS=192.168.1.50` (o el nombre que uses).

## Cómo se estudia

Los repasos usan un **sistema Leitner simplificado de dos capas**: cada pregunta tiene una caja (0-6) y una fecha de vencimiento.

- Acertar sube la pregunta una caja y programa el siguiente repaso con intervalos crecientes (1, 3, 7, 16, 35 y 90 días). En el test libre, acertar solo actualiza contadores: no adelanta repasos.
- Fallar baja la pregunta dos cajas (mínimo 1), la marca como vencida hoy y la reintenta dentro de la misma sesión.
- El test mezcla preguntas vencidas, nuevas y repasos, y muestra la explicación cuando fallas.
- Cada día hay un **cupo de 15 preguntas nuevas**; cuando se agota (o si tienes demasiados repasos atrasados), el test continúa solo con repasos. La aplicación muestra el cupo en la pantalla del tema.
- Puedes fijar la **fecha del examen**: a partir de ahí, los intervalos de repaso se acortan para no dejar huecos largos sin margen.
- Los simulacros están cronometrados y admiten puntuación con penalización. Fallar también baja dos cajas; acertar solo actualiza contadores. Un simulacro se puede reanudar si cierras la pestaña, y el guardado es idempotente.
- Las estadísticas muestran el estado por tema, la previsión de repasos, el acierto semanal, la racha, el tiempo medio, las preguntas que más fallas y la evolución de tus simulacros.

La estrategia se apoya en el efecto de espaciado y en el recuerdo activo (testing). Los tramos 1/7/16/35 coinciden con el algoritmo SM-0 de Wozniak, pero la secuencia exacta (con el paso de 3 días y el de 90) es una elección práctica, no una recomendación científica.

## Bibliografía

**Fundamentos**

1. Butler, A. C., & Roediger, H. L. (2008). Feedback enhances the positive effects and reduces the negative effects of multiple-choice testing. *Memory & Cognition, 36*(3), 604-616. https://doi.org/10.3758/MC.36.3.604
2. Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin, 132*(3), 354-380. https://doi.org/10.1037/0033-2909.132.3.354
3. Cepeda, N. J., Vul, E., Rohrer, D., Wixted, J. T., & Pashler, H. (2008). Spacing effects in learning: A temporal ridgeline of optimal retention. *Psychological Science, 19*(11), 1095-1102. https://doi.org/10.1111/j.1467-9280.2008.02209.x
4. Ebbinghaus, H. (1885). *Über das Gedächtnis: Untersuchungen zur experimentellen Psychologie*. Duncker & Humblot.
5. Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science, 17*(3), 249-255. https://doi.org/10.1111/j.1467-9280.2006.01693.x

**Algoritmos**

6. Leitner, S. (1972). *So lernt man lernen*. Herder.
7. Wozniak, P. A. (1990). *Optimization of learning: A new approach and computer application* [Tesis de máster, Universidad de Tecnología de Poznań]. https://www.supermemo.com/en/blog/optimization-of-learning
8. Ye, J., Su, J., & Cao, Y. (2022). A stochastic shortest path algorithm for optimizing spaced repetition scheduling. En *KDD '22: Proceedings of the 28th ACM SIGKDD Conference on Knowledge Discovery and Data Mining* (pp. 4381-4390). Association for Computing Machinery. https://doi.org/10.1145/3534678.3539081

**Fuentes prácticas**

9. Anki. (s.f.). *Deck options*. Manual de Anki. https://docs.ankiweb.net/deck-options.html
10. *Which guideline should I follow: FSRS simulation results or the new card/review limit ratio rule?* (s.f.). [Hilo de foro]. Anki Forums. https://forums.ankiweb.net/t/which-guideline-should-i-follow-fsrs-simulation-results-or-the-new-card-review-limit-ratio-rule/70470

## Licencia

MIT © 2026 filipondios. Consulta [`LICENSE`](LICENSE).
