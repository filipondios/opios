<p align="center">
  <img src="public/logo.png" alt="opios" width="150">
</p>

<h1 align="center">opios</h1>

<p align="center"><em>Un entrenador en local para exámenes tipo test, con repaso espaciado.</em></p>

<p align="center">
  <a href="https://github.com/filipondios/opios/actions/workflows/test.yml"><img src="https://badgen.net/github/checks/filipondios/opios/multiplataforma?label=tests&style=flat-square" alt="Estado de los tests"></a>
  <a href="https://github.com/filipondios/opios/blob/multiplataforma/LICENSE"><img src="https://badgen.net/github/license/filipondios/opios?label=licencia&style=flat-square" alt="Licencia"></a>
  <img src="https://badgen.net/badge/Bun/1.4.3%2B?icon=bun&style=flat-square" alt="Bun 1.4.3 o superior">
</p>

**Opios** es una aplicación para estudiar bancos de preguntas de tipo test: organizas las preguntas por bloques y temas, y practicas con tests libres, simulacros cronometrados y repasos programados. Funciona en tu ordenador y en Android. Todo se guarda en tu dispositivo: sin cuentas, sin nube y sin enviar tus datos a ningún servidor.

La herramienta es genérica: no incluye ningún banco propio, aunque la creé para preparar las oposiciones al [Cuerpo de Técnicos Auxiliares de Informática de la Administración del Estado](https://www.inap.es/es/seleccion/procesos-selectivos-de-cuerposescalas-generales/cuerpo-de-tecnicos-auxiliares-de-informatica-de-la-administracion-del-estado/que-es-el-cuerpo-de-tecnicos-auxiliares-de-informatica-de-la-administracion-del-estado) (España). Incluye un **banco de ejemplo** para que puedas probarla nada más instalarla. Algunas de sus funcionalidades:

- Tests libres que combinan preguntas nuevas con repasos pendientes.
- Simulacros cronometrados con penalización opcional y posibilidad de reanudarlos.
- Repaso espaciado con un cupo diario de preguntas nuevas.
- Estadísticas: progreso por tema, previsión de repasos, acierto semanal, racha, tiempo medio y preguntas más falladas.
- Varios bancos a la vez, con importación, exportación, copias de seguridad y actualización sin perder el progreso.

## Inicio rápido en el ordenador

Necesitas [Bun](https://bun.sh) 1.4.3 o superior.

```bash
bun install    # instala las dependencias (la primera vez)
bun start      # abre http://127.0.0.1:8000
```

Si no tienes un banco propio, la app usa automáticamente el de ejemplo (`./ejemplo/`). Para importar un banco nuevo desde cero, ejecuta `bun run seed`. El progreso se guarda en `data/opios.db` por defecto y se conserva entre arranques.

Comandos útiles para gestionar tus bancos:

```bash
bun run validar                 # comprueba un banco (formato, avisos, sesgo) sin tocar tu base de datos
bun run calidad                 # sesgo de la opción más larga y posición de la correcta
bun run calidad --lista         # muestra las preguntas sesgadas con sus opciones
bun run ids                     # asigna id_externo estable a las preguntas que no lo tengan
bun run seed --actualizar       # actualiza preguntas editadas conservando su id y progreso
```

`bun run calidad` analiza solo lo que la app importa. Con `--incluir <carpeta>` (repetible) añade otras carpetas del bloque. Usa `--umbral N` para cambiar el umbral (30 % por defecto) y `--fallar` para que el comando salga con error si algún archivo lo supera.

## Configuración desde `.env` (en el ordenador)

Todo se ajusta en un archivo `.env` junto al código: Bun lo carga automáticamente al arrancar. Empieza copiando la plantilla y descomenta lo que necesites:

```bash
cp .env.example .env
```

Las variables principales son:

- **`OPIOS_PREGUNTAS`**: ruta de tu banco de preguntas (un directorio de JSON). Si no la defines, se usa `./ejemplo/` (o `./preguntas/` si existe). Si la defines y la carpeta no existe, la app avisa y no arranca.
- **`OPIOS_SEED`**: `vacia` (por defecto) importa solo si la base está vacía; `auto` vuelve a importar en cada arranque actualizando por `id_externo` (sin duplicar); `no` nunca importa.
- **`OPIOS_DATOS` / `OPIOS_CATALOGO`**: eligen el modo de la app (ver abajo). `OPIOS_DB` indica la base en modo directo.
- El resto está comentado y explicado en [`.env.example`](.env.example). Referencia rápida:

| Variable                  | Por defecto                             | Para qué sirve                                                                                               |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `OPIOS_PREGUNTAS`         | `./ejemplo` (o `./preguntas` si existe) | Directorio del banco de preguntas                                                                            |
| `OPIOS_SEED`              | `vacia`                                 | Cuándo importar al arrancar: `vacia`, `auto` o `no`                                                          |
| `OPIOS_DB`                | `data/opios.db`                         | Base de datos en modo directo                                                                                |
| `OPIOS_DATOS`             | -                                       | Modo biblioteca: carpeta con `catalogo.db` y los bancos de Opios (en Docker, `/data`)                        |
| `OPIOS_CATALOGO`          | -                                       | Modo biblioteca con ruta exacta al catálogo (alternativa antigua a `OPIOS_DATOS`)                            |
| `APP_TZ`                  | zona horaria del sistema                | Zona horaria usada para calcular "hoy" (por ejemplo `Europe/Madrid`)                                         |
| `PORT`                    | `8000`                                  | Puerto                                                                                                       |
| `HOST`                    | `127.0.0.1`                             | Interfaz en la que escuchar                                                                                  |
| `AUTH_USER` + `AUTH_PASS` | -                                       | Autenticación básica HTTP cuando se definen ambas                                                            |
| `ALLOWED_HOSTS`           | solo loopback                           | Valores de `Host` adicionales que aceptar, separados por comas (`localhost` y `127.0.0.1` siempre funcionan) |
| `OPIOS_AVISO_VERSION`     | `1`                                     | Aviso de versión nueva en la cabecera; `0` lo desactiva                                                      |

Los límites diarios (15 preguntas nuevas al día, el freno de repasos atrasados) y el factor que acorta los intervalos según se acerca el examen son constantes de `src/config.js` (`CUPO_NUEVAS`, `FRENO_ATRASO`, `FACTOR_EXAMEN`).

### Modo directo (un banco)

Es el que hay por defecto: no definas `OPIOS_DATOS` ni `OPIOS_CATALOGO`. La app usa un único banco en `data/opios.db` (o donde diga `OPIOS_DB`). Para cargar el tuyo:

```bash
# en .env: OPIOS_PREGUNTAS=./tu-banco
bun run seed   # importa tu banco
bun start      # abre http://127.0.0.1:8000
```

En este modo la pestaña **Bancos** no está disponible: la app lo indica con un mensaje. Para varios bancos, usa el modo biblioteca.

### Modo biblioteca (varios bancos)

Se activa definiendo **`OPIOS_DATOS`** en `.env` con una carpeta de datos:

```bash
# en .env: OPIOS_DATOS=./mis-datos
mkdir -p mis-datos
bun run bancos importar "Mi banco" ./ejemplo   # crea el catálogo y un banco
bun run bancos activar 1                       # elige el banco activo
bun start                                      # abre http://127.0.0.1:8000
```

El catálogo (`catalogo.db`) y los bancos viven en esa carpeta. El servidor se niega a arrancar si no hay un banco activo: usa `bun run bancos listar` para ver los bancos y `bun run bancos activar <id>` para elegir uno. `OPIOS_CATALOGO` es la forma antigua (ruta exacta al archivo de catálogo) y manda si ambas están definidas. No hace falta pasar estas variables en cada comando: Bun carga `.env` tanto para el servidor como para `bun run bancos`.

En este modo la pestaña **Bancos** permite importar `.opios`/SQLite/JSON/zip, crear un banco vacío, alternar entre bancos, renombrarlos, actualizarlos, exportarlos, gestionar copias y deshacer cambios:

- **Estudiar** activa ese banco y abre la portada; el progreso de cada banco se guarda por separado.
- **Usar donde está** registra un archivo `.db` externo sin copiarlo: el progreso se guarda en ese archivo. Si luego no está disponible, la tarjeta ofrece **Localizar** o **Quitar de la biblioteca** (sin borrar el archivo). **Importar archivo…**, en cambio, hace una copia gestionada por Opios.
- **Actualizar** vuelve a importar desde el directorio JSON y fusiona por `id_externo`: conserva los ids y el progreso, actualiza los enunciados cambiados y **archiva** (no borra) las preguntas que ya no están en el origen; se pueden recuperar si vuelven. **Deshacer última actualización** revierte el cambio usando las instantáneas rotativas (últimas 3).
- **Exportar con/sin progreso**: la segunda opción vacía progreso, respuestas y simulacros de la copia, ideal para compartir un banco sin datos personales. El banco original nunca se toca.

## Formato y estructura del banco

Un banco es una carpeta con sub carpetas `bloque_N/` que contienen:

```text
mi-banco/
├── bloque_1/
│   ├── info.json      # nombre del bloque y títulos de sus temas
│   ├── tema_1.json    # lista de preguntas del tema 1
│   └── tema_2.json
└── bloque_2/
    ├── info.json
    └── tema_1.json
```

Solo se importan `bloque_N/info.json` y `bloque_N/tema_N.json`; cualquier otro archivo se ignora. Los nombres son estrictos: `Bloque_1/`, `bloque_01/`, `TEMA_1.json` o `tema_01.json` se ignoran con un aviso.

`info.json` describe el bloque:

```json
{
    "nombre": "Bloque 1. Geografía",
    "temas": [{ "numero": 1, "titulo": "Geografía física" }]
}
```

Cada `tema_N.json` es una lista de preguntas (o un objeto `{ "preguntas": [...] }`). Cada pregunta:

```json
{
    "pregunta": "¿Cuál es el río más caudaloso del mundo?",
    "respuestas": ["El Amazonas", "El Misisipi", "El Nilo", "El Volga"],
    "respuesta_correcta": "a",
    "explicacion": "El Amazonas es el río con mayor caudal.",
    "id_externo": "geografia-01"
}
```

- `pregunta`: el enunciado.
- `respuestas`: entre 2 y 8 opciones.
- `respuesta_correcta`: la letra de la correcta (`a`, `b`, `c`...).
- `explicacion`: texto que se muestra al responder (opcional).
- `id_externo`: identificador estable; al actualizar el banco permite conservar el progreso de cada pregunta aunque cambie de sitio o de enunciado. Es opcional, pero muy recomendable (`bun run ids` lo añade).

Además del directorio JSON, la app trabaja con bancos empaquetados:

- **`.opios`**: un archivo gzip con una cabecera `opios-banco\0`, un manifest JSON (`formato: 1`, nombre, versión, número de preguntas y `incluye_progreso`) y la base SQLite. Se exporta desde la pestaña Bancos, con o sin progreso.
- **`.opios-backup`**: un zip con un `.opios` por banco y su manifest; es la copia completa que descarga "Descargar copia completa".
- **SQLite (`.db`)** y **zip de carpetas JSON**: también se pueden importar desde el asistente.

Puedes validar un directorio antes de importarlo con `bun run validar`.

## Copias de seguridad

En modo biblioteca (o en Android), la pestaña **Bancos** permite descargar una copia completa (todos tus bancos, `.opios-backup`), exportar cada banco con o sin progreso, restaurar copias y deshacer la última actualización. Las instantáneas se rotan (últimas 3). En modo directo, usa los comandos de abajo.

Desde la terminal:

```bash
bun run backup                      # data/opios-YYYYMMDD-HHMMSS.db (incluye el progreso)
bun run backup copia.db             # escribe en un archivo concreto
bun run export copia.json           # formato JSON antiguo (solo preguntas)
bun run export --por-bloques copia/ # bloque_X/info.json + tema_N.json
```

Para restaurar una copia desde la terminal, para la app y copia el archivo sobre `data/opios.db`, o arranca con `OPIOS_DB=copia.db`.

## Docker

```bash
docker compose up --build
```

`docker-compose.yml` monta el banco como volumen de solo lectura y publica el puerto solo en loopback. La imagen trae el banco de ejemplo; monta el tuyo con `OPIOS_PREGUNTAS` para importarlo.

La imagen arranca en **modo biblioteca** (`OPIOS_DATOS=/data`): el catálogo y los bancos viven en el volumen `opios-data`, así que sobreviven a `docker compose down` y se gestionan desde la pestaña «Bancos». Para actualizar sobre datos existentes, para el contenedor y ejecuta `OPIOS_DATOS=/ruta/al/volumen bun run migrar` (guarda antes una instantánea de cada banco). Si un banco tiene un esquema más nuevo, se deja intacto y avisa de que hay que actualizar Opios.

El contenedor corre con el usuario `bun` y solo acepta cabeceras `Host` de loopback. Para acceder desde la LAN, añade `-e ALLOWED_HOSTS=192.168.1.50` (o el nombre que uses).

## Opios en Android

La app funciona también en Android (Android 7 o superior). Descarga el APK de la sección [Releases](https://github.com/filipondios/opios/releases) e instálalo. El sistema te pedirá permiso para instalar apps de fuentes desconocidas la primera vez. Podrás ver que en el primer arranque no hay ningún banco, ya que la app abre directamente la pestaña **Bancos** y no trae banco de ejemplo en Android, así que añade el tuyo.

**¿Cómo añado un banco?**: En la pestaña **Bancos**, pulsa "Importar archivo..." y elige en el selector de archivos del sistema un `.opios`, una base SQLite (`.db`), un `.zip` con carpetas `bloque_N/`, o un `.json` con preguntas. Revisa la previsualización y confirma. El archivo elegido se copia al almacenamiento privado de la app: el original no se toca y no hace falta permiso de acceso a archivos. También puedes crear un banco vacío con "Crear banco vacío" y después añadir preguntas desde el creador.

**¿Cómo uso varios bancos?**: Cada banco listado tiene un botón **Estudiar** (lo activa y abre la portada), **Exportar** (con o sin progreso), **Cambiar nombre** y **Eliminar**. Puedes alternar entre ellos cuando quieras y el progreso de cada uno se conserva. Las copias de seguridad y restauraciones están en la misma sección, bajo "Copias de seguridad".

**¿Dónde se guarda todo?**: En el almacenamiento privado de la app (`files/banco/`). No se sube a ningún servidor. Si desinstalas la app, Android borra esos datos, así que exporta antes una copia desde **Bancos > Descargar copia completa** si quieres conservarlos. Los avisos de versiones nuevas se comprueban en segundo plano y funcionan igual sin conexión.

**Actualizaciones**: Al abrir una versión nueva se migra la base de datos automáticamente. Si un banco fuera de una versión más nueva, se deja intacto y se pide actualizar la app.

## Cómo se estudia

La barra de navegación tiene seis secciones: **Test** (la portada, con el resumen de hoy y la selección de temas), **Simulacro**, **Estadísticas**, **Maker** (crear y editar preguntas), **Temario** (organizar bloques y temas) y **Bancos** (solo en modo biblioteca o Android). El tema claro/oscuro se cambia con el botón de la esquina superior; la preferencia se guarda en el dispositivo.

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

1. Butler, A. C., & Roediger, H. L. (2008). Feedback enhances the positive effects and reduces the negative effects of multiple-choice testing. _Memory & Cognition, 36_(3), 604-616. https://doi.org/10.3758/MC.36.3.604
2. Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. _Psychological Bulletin, 132_(3), 354-380. https://doi.org/10.1037/0033-2909.132.3.354
3. Cepeda, N. J., Vul, E., Rohrer, D., Wixted, J. T., & Pashler, H. (2008). Spacing effects in learning: A temporal ridgeline of optimal retention. _Psychological Science, 19_(11), 1095-1102. https://doi.org/10.1111/j.1467-9280.2008.02209.x
4. Ebbinghaus, H. (1885). _Über das Gedächtnis: Untersuchungen zur experimentellen Psychologie_. Duncker & Humblot.
5. Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. _Psychological Science, 17_(3), 249-255. https://doi.org/10.1111/j.1467-9280.2006.01693.x

**Algoritmos**

6. Leitner, S. (1972). _So lernt man lernen_. Herder.
7. Wozniak, P. A. (1990). _Optimization of learning: A new approach and computer application_ [Tesis de máster, Universidad de Tecnología de Poznań]. https://www.supermemo.com/en/blog/optimization-of-learning
8. Ye, J., Su, J., & Cao, Y. (2022). A stochastic shortest path algorithm for optimizing spaced repetition scheduling. En _KDD '22: Proceedings of the 28th ACM SIGKDD Conference on Knowledge Discovery and Data Mining_ (pp. 4381-4390). Association for Computing Machinery. https://doi.org/10.1145/3534678.3539081

**Fuentes prácticas**

9. Anki. (s.f.). _Deck options_. Manual de Anki. https://docs.ankiweb.net/deck-options.html
10. _Which guideline should I follow: FSRS simulation results or the new card/review limit ratio rule?_ (s.f.). [Hilo de foro]. Anki Forums. https://forums.ankiweb.net/t/which-guideline-should-i-follow-fsrs-simulation-results-or-the-new-card-review-limit-ratio-rule/70470

## Licencia

MIT © 2026 filipondios. Consulta [`LICENSE`](LICENSE).
