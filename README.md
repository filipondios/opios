# Test infinito (`opios`)

A self-hosted web app for learning through multiple-choice questions, built for exam preparation (Spanish Constitutional Law / State organization content). Pick one or more topics, answer questions, and the app schedules reviews with a spaced-repetition box system. It also includes a question editor and a syllabus manager for blocks and topics.

The app is **single-instance and single-user**: the question bank and learning progress are shared globally for that instance.

## Features

- **Spaced repetition** with 7 boxes and intervals of `[0, 1, 3, 7, 16, 35, 90]` days.
- **Session retries**: failed questions come back within the same session before being rescheduled.
- **Topic dashboard** with counts per topic: total, new, due for review, mastered, and learning.
- **Question maker** at `/maker` with duplicate detection by question text.
- **Syllabus manager** at `/temario`: blocks, topics, ordering, and per-topic question counts.
- **Question import/export** in a simple JSON format.
- **Keyboard shortcuts** in the test view (arrows, `A`–`H`/`1`–`9`, `Enter`, `Esc`).
- **Optional HTTP Basic authentication** and a `/healthz` endpoint for deployments.
- **Zero runtime dependencies**: only Bun and SQLite.

## Tech stack

- **Runtime:** [Bun](https://bun.sh/) (tested with Bun 1.4.3). No Node, no bundler, no build step.
- **Server:** `Bun.serve` with a single `fetch` handler.
- **Database:** SQLite via `bun:sqlite`, stored at `data/opios.db` by default (WAL mode).
- **Frontend:** server-rendered HTML using tagged template literals plus vanilla JavaScript in the browser. No frameworks.
- **Dependencies:** none (`package.json` has no `dependencies` or `devDependencies`).

The UI, source comments, and domain names are in Spanish.

## Quick start

Requirements: [Bun](https://bun.sh/) installed.

```bash
bun --version       # Bun is the only requirement
bun run seed        # import preguntas/*.json into data/opios.db (idempotent)
bun run dev         # start with reload at http://127.0.0.1:8000
bun start           # start without watch mode
bun test            # run the test suite
```

On first run, if the database is empty, `server.js` automatically imports the JSON files from `preguntas/`.

## Scripts

| Command | Description |
|---|---|
| `bun start` | Start the server. |
| `bun run dev` | Start the server with file watching. |
| `bun run seed` | Import `preguntas/*.json` into the database. Safe to run repeatedly. |
| `bun run export` | Dump the whole database as JSON to stdout. |
| `bun run export copia.json` | Dump the database to a file. |
| `bun scripts/seed.js <dir>` | Import a different directory of JSON files. |
| `bun test` | Run the integration tests. |

## Configuration

Environment variables (see `src/config.js`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8000` | HTTP port. |
| `HOST` | `127.0.0.1` | Listen interface. |
| `AUTH_USER` + `AUTH_PASS` | — | If both are set, HTTP Basic auth is required on every route except `/healthz`. |
| `OPIOS_DB` | `data/opios.db` | SQLite database path. |

If no auth is configured and the host is not local, the server prints a warning at startup.

## Project structure

```text
server.js                 Entry point: opens the DB, seeds if empty, starts Bun.serve
src/
  config.js               Paths, port, host, auth, validation constants
  app.js                  HTTP router, Basic auth, static files, error handling
  db.js                   Schema, migrations, and SQLite repository
  seed.js                 Import JSON directories
  exportar.js             Serialize to the legacy JSON format
  validar.js              Input validation/normalization and format conversion
  errores.js              ErrorApi (error carrying an HTTP status)
  fechas.js               hoyIso(): local date as YYYY-MM-DD
  views/
    html.js               html`` template engine with automatic escaping
    layout.js             Shared base layout
    home.js               Topic selection + test screen
    maker.js              Question maker page
    temario.js            Block/topic management page
public/
  css/{base,test,maker,temario}.css
  js/{test,maker,temario}.js
preguntas/                Importable question bank (JSON)
apuntes/                  Study notes
scripts/{seed,export}.js  CLI helpers
test/app.test.js          Integration tests
data/opios.db             Local database (git-ignored)
Dockerfile                Production image
```

## Data model

The schema is managed with sequential migrations tracked by SQLite's `PRAGMA user_version`.

- **`bloques`** — syllabus blocks: `id`, `nombre` (unique, case-insensitive), `orden`.
- **`temas`** — topics within a block: `id`, `bloque_id`, `numero`, optional `nombre`. Unique on `(bloque_id, numero)`.
- **`preguntas`** — questions: `id`, `tema_id`, `enunciado`, unique `clave`, `explicacion`, timestamps.
- **`opciones`** — answer options: `id`, `pregunta_id`, `posicion` (0 = A), `texto`, `es_correcta`. A partial unique index guarantees at most one correct option per question.
- **`progreso`** — repetition state per question: `pregunta_id`, `caja` (0–6), `vence` (due date), `aciertos`, `fallos`, `actualizado`.

Deleting a question cascades to its options and progress. Deleting a block with topics or a topic with questions is rejected with `409`, so those deletes are not cascading.

The `clave` (key) is a question's logical identity: the statement with collapsed whitespace and trimmed ends. It is case-sensitive, so duplicates are detected by statement text, not by `id`.

## Question JSON format

Each file is an array of objects:

```json
{
  "tema": 3,
  "pregunta": "¿Qué Título de la Constitución está dedicado a la regulación del Gobierno?",
  "respuestas": ["Título V", "Título IV", "Título VI", "Título III"],
  "respuesta_correcta": "b",
  "explicacion": "El Título IV de la Constitución, artículos 97 a 107, está dedicado al Gobierno y a la Administración."
}
```

- `respuesta_correcta` is a **letter** (`a`–`h`, case-insensitive). If missing or empty, it defaults to `a` for backward compatibility. The exact text of an option is also accepted as a fallback.
- `respuestas` accepts 2 to 8 options.
- Optional `bloque` and `tema_numero` fields preserve the syllabus structure when exporting and reimporting.
- Files may be either an array or an object `{ "preguntas": [...] }` (import only).
- The internal API uses `correcta` as a **0-based index**, not a letter.

Validation limits: topic `0..9999`; statement 2000 chars; option 1000 chars; explanation 4000 chars; block name 120; topic name 200; box `0..6`.

## Import, export, and duplicates

- The seed reads only `*.json` files directly inside the given directory, **not subdirectories**. That is why `preguntas/generated/` and `preguntas/examenes/` are not imported.
- Import is idempotent: questions whose key already exists are skipped and counted as duplicates.
- **Editing a question's statement in JSON and reseeding does not update the existing question.** It creates a new one and leaves the old one in place. Use the maker (`/maker`) or the API to modify imported questions.
- Export uses the same JSON format, including `bloque` and `tema_numero` when applicable, so reimporting preserves the syllabus.
- Creating a question whose key already exists via the API returns `409` with `{ existente: { id, tema } }`; the client can offer to replace it.

## HTTP API

All JSON responses include `Cache-Control: no-store`. Write requests must use `application/json` (`415` otherwise) and are limited to 2 MB (`413`).

| Method | Path | Body / params | Response |
|---|---|---|---|
| GET | `/healthz` | — | `ok` (always unauthenticated) |
| GET | `/api/temas` | — | `[{ tema, total }]` |
| GET | `/api/temario` | — | Blocks with their topics and question counts |
| POST | `/api/bloques` | `{ nombre }` | `201`, created block |
| PUT | `/api/bloques/:id` | `{ nombre }` | Updated block |
| DELETE | `/api/bloques/:id` | — | `204`; `409` if it has topics |
| POST | `/api/bloques/reordenar` | `{ ids: number[] }` | `{ ok: true }` |
| POST | `/api/temas` | `{ bloque, numero, nombre }` | `201`, created topic |
| PUT | `/api/temas/:id` | `{ bloque, numero, nombre }` | Updated topic |
| DELETE | `/api/temas/:id` | — | `204`; `409` if it has questions |
| GET | `/api/test?temas=1,2,3` | Topic id list | `{ preguntas, progreso }` |
| POST | `/api/progreso` | `[{ id, caja, vence, aciertos, fallos }]` | `{ guardadas }` |
| DELETE | `/api/progreso` | — | `{ ok: true }` (resets all progress) |
| GET | `/api/exportar` | — | JSON download |
| GET | `/api/preguntas?tema=&q=&limite=&desde=` | Pagination and search | `{ total, items }` |
| POST | `/api/preguntas` | Question in API format | `201`, created question |
| GET | `/api/preguntas/:id` | — | Question |
| PUT | `/api/preguntas/:id` | Question in API format | Updated question |
| DELETE | `/api/preguntas/:id` | — | `204` |

Question API format:

```json
{
  "tema": 3,
  "pregunta": "...",
  "respuestas": ["...", "..."],
  "correcta": 1,
  "explicacion": "..."
}
```

Enriched response:

```json
{
  "id": 42,
  "tema": 3,
  "tema_numero": 3,
  "tema_nombre": null,
  "bloque": 1,
  "bloque_nombre": "Bloque 1",
  "pregunta": "...",
  "respuestas": ["...", "..."],
  "correcta": 1,
  "explicacion": "..."
}
```

Notes:

- `tema` is the `temas` row **id**, not the visible topic number (that is `tema_numero`).
- `GET /api/preguntas` paginates 50 items at a time by default (max 200). Text search runs in JavaScript because SQLite's `lower()` does not handle accents well.
- `POST /api/preguntas` creates the topic automatically if its id does not exist. If `bloque` is provided, it creates the block/topic from `bloque` and `tema_numero`.
- Progress writes silently ignore nonexistent question ids.
- Error codes: `400` validation, `401` auth, `404` not found, `409` conflict/duplicate, `413` body too large, `415` wrong content type, `500` unexpected error.

## Spaced repetition logic

- Progress is represented as `id -> [caja, vence, aciertos, fallos]`.
- Boxes and intervals: `[0, 1, 3, 7, 16, 35, 90]` days.
- **Correct answer:** move up one box (max 6) and set `vence = today + interval[caja]`.
- **Wrong answer:** back to box 0, `vence = today`, and the question re-enters a retry cycle in the session: it reappears after 3 questions, then after 8 if answered correctly, and finally graduates to box 1.
- A question failed in a previous session with box 0 gets one additional retry before graduating.
- **Selection priority:** due retries; due reviews and new questions (60% chance of a review when both exist); new questions; not-yet-due retries; then infinite free practice weighted toward low boxes and questions with more failures.
- Options are shuffled on every presentation; the correct index is remapped to the shuffled order.
- Progress is saved in batches: 700 ms after the last change, on tab hide (`visibilitychange`), and on page close (`pagehide`) with `keepalive`.
- **Reset progress** requires a double press and calls `DELETE /api/progreso`.
- Selected topics are persisted in `localStorage` under the key `ti.sel`.
- Shortcuts: arrows to move, `A`–`H` or `1`–`9` to jump, `Enter` to confirm/continue, `Esc` to exit.

Topic statistics:

- `total`: questions in the topic.
- `nuevas`: no row in `progreso`.
- `repaso`: `vence <= today`.
- `dominadas`: `caja >= 4`.
- `aprendiendo`: `caja < 4` (new questions are not counted here).

## Testing

```bash
bun test
```

The suite uses `bun:test` and lives in `test/app.test.js`. Each test opens an in-memory database (`abrirDb(":memory:")`) and creates the app without a network socket.

Tests import the real JSON files from `preguntas/`, so expected totals are coupled to the current bank:

- 515 imported questions in total;
- topic 1: 215; topic 2: 215; topic 3: 85;
- the initial syllabus must contain topics `[1, 2, 3]`.

Update those numbers in the test whenever questions are added or removed.

## Docker

```bash
docker build -t opios .
docker run -d -p 10000:10000 -v opios-data:/data \
  -e AUTH_USER=usuario -e AUTH_PASS=clave opios
```

The image uses `oven/bun:1-slim`, sets `HOST=0.0.0.0`, `PORT=10000`, and `OPIOS_DB=/data/opios.db`, exposes port `10000`, mounts `/data` as a volume, and runs a healthcheck against `/healthz`.

## Resetting the database

```bash
rm -f data/opios.db data/opios.db-wal data/opios.db-shm
bun run seed
```

This also deletes all learning progress.

## License

MIT © 2026 filipondios. See [LICENSE](LICENSE).
