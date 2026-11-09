# Notas de versión

## v1.0.0 — 2026-11-09

Primera versión estable de `opios`.

### Qué incluye

- Aplicación genérica: lee el banco de `OPIOS_PREGUNTAS` (por defecto `./preguntas` si existe y, si no, `./ejemplo`).
- Banco por bloques: `bloque_N/info.json` + `bloque_N/tema_N.json`. Cualquier otro archivo o carpeta se ignora.
- Tests libres con repaso espaciado (cajas 0–6), cupo diario de 15 preguntas nuevas y freno si hay demasiados repasos atrasados.
- Simulacros cronometrados con penalización opcional, reanudación y guardado idempotente.
- Estadísticas: progreso por tema, previsión de repasos, actividad, precisión semanal, racha, tiempo medio y preguntas más falladas.
- Creador de preguntas y gestor de temario por bloques.
- Fiabilidad: `busy_timeout` y `synchronous = NORMAL`, errores cortos en los CLIs, `ETag`/304 en estáticos, cabeceras de seguridad, `POST /api/sesion` transaccional con contadores incrementales, límite de cuerpo en bytes y relectura de la carga si la sesión cruza la medianoche.
- Docker: imagen sin banco y `docker-compose.yml` con el banco montado en solo lectura.
- Sin dependencias externas: solo Bun y SQLite.

### Requisitos

- Bun 1.4.3 o superior.
