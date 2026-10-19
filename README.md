# opios

Test infinito: practica preguntas tipo test por temas con repaso espaciado, y añade preguntas desde el navegador.
Servidor en **Bun** con **SQLite** (`bun:sqlite`), sin dependencias que instalar.

## Uso

```sh
bun start            # http://127.0.0.1:8000  (PORT=… y HOST=… para cambiarlo)
```

- `/` — hacer test (elige temas, repaso espaciado; botón «Añadir preguntas»).
- `/maker` — crear, editar, buscar y borrar preguntas directamente en la base de datos (botón «Hacer test»).

La base de datos `data/opios.db` se crea sola. Si está vacía al arrancar, se importan los JSON de `preguntas/`.

| Comando | Qué hace |
|---|---|
| `bun run seed [dir]` | Importa JSON (formato antiguo) a la DB; se puede repetir sin duplicar |
| `bun run export [archivo]` | Vuelca la DB al formato JSON antiguo (copia de seguridad) |
| `bun test` | Pruebas de la API y la capa de datos |

## Estructura

```
server.js          arranque (Bun.serve) + importación inicial
src/app.js         rutas: páginas, API JSON y estáticos
src/db.js          esquema SQL y consultas
src/validar.js     validación de preguntas y progreso
src/views/         plantillas (html``, layout, home, maker)
public/            css/ y js/ del navegador
scripts/           seed y export
preguntas/         JSON semilla
```

## Modelo de datos

`temas` ← `preguntas` ← `opciones` (una fila por opción, con `posicion` y `es_correcta`; índice único parcial: una sola correcta por pregunta) y `progreso` (una fila por pregunta: `caja`, `vence`, `aciertos`, `fallos`).

## API

`GET /api/test?temas=1,2` · `POST|DELETE /api/progreso` · `GET|POST /api/preguntas` · `GET|PUT|DELETE /api/preguntas/:id` · `GET /api/temas` · `GET /api/exportar`

## Despliegue en Render (Docker)

1. Crea un **Web Service** con entorno Docker apuntando al repo (o usa `render.yaml` como Blueprint).
2. Define `AUTH_USER` y `AUTH_PASS`: sin ellos cualquiera con la URL puede editar o borrar preguntas.
3. Añade un **disco persistente** montado en `/data` (plan de pago). Sin disco, la DB se reinicia con cada despliegue: se vuelven a importar los JSON de `preguntas/`, pero se pierde el progreso y las preguntas añadidas desde el creador.
4. Health check path: `/healthz`. Render inyecta `PORT`; la imagen ya escucha en `0.0.0.0`.

Local con Docker: `docker build -t opios . && docker run -p 10000:10000 -v opios-data:/data opios`
