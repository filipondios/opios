<p align="center">
  <img src="logo.png" alt="opios" width="240">
</p>

<h1 align="center">opios</h1>

<p align="center"><em>Un entrenador en local para exámenes tipo test, con repaso espaciado.</em></p>

opios es una pequeña aplicación autoalojada para estudiar bancos de preguntas de oposiciones. Organizas las preguntas por bloques y temas, y luego practicas con tests libres, simulacros cronometrados y repasos programados. Funciona íntegramente en tu máquina con Bun y SQLite: sin cuentas, sin nube y sin dependencias externas.

Actualmente incluye el banco de preguntas de las oposiciones al [Cuerpo de Técnicos Auxiliares de Informática de la Administración del Estado](https://www.inap.es/es/seleccion/procesos-selectivos-de-cuerposescalas-generales/cuerpo-de-tecnicos-auxiliares-de-informatica-de-la-administracion-del-estado/que-es-el-cuerpo-de-tecnicos-auxiliares-de-informatica-de-la-administracion-del-estado) (España), que es para lo que se creó, aunque la estructura de bloques y temas permite añadir cualquier otro temario.

- Tests libres que combinan preguntas nuevas con repasos pendientes.
- Simulacros cronometrados con penalización opcional y posibilidad de reanudarlos.
- Programación con repaso espaciado y un cupo diario de preguntas nuevas.
- Estadísticas: progreso por tema, previsión de repasos, acierto semanal, racha, tiempo medio y preguntas más falladas.
- Todo en local: tu banco y tu progreso viven en un único archivo SQLite.

## Inicio rápido

Solo necesitas [Bun](https://bun.sh); no hay paquetes que instalar.

```bash
bun run seed   # importa el banco de preguntas en data/opios.db (puede repetirse sin problema)
bun start      # abre http://127.0.0.1:8000
bun test
```

En el primer arranque, si la base de datos está vacía, el banco se importa automáticamente. `bun run dev` arranca el servidor en modo vigilancia.

## Copias de seguridad

```bash
bun run backup                      # data/opios-YYYYMMDD-HHMMSS.db (incluye el progreso)
bun run backup copia.db             # escribe en un archivo concreto
bun run export copia.json           # formato JSON antiguo (solo preguntas)
bun run export --por-bloques copia/ # bloque_X/info.json + tema_N.json
```

Para restaurar una copia, para la aplicación y copia el archivo sobre `data/opios.db`, o arranca con `OPIOS_DB=copia.db`.

## Estructura del banco de preguntas

El banco vive en el directorio `preguntas/`, con un subdirectorio por bloque:

```
preguntas/
  bloque_1/
    info.json      nombre del bloque y títulos de los temas
    tema_1.json    preguntas del tema 1
    tema_2.json    preguntas del tema 2
    ...
  bloque_2/
    ...
  examenes/        material oficial y extractos; no se importa
```

- Cada directorio `bloque_N/` define un bloque, y `N` es su número estable.
- `info.json` contiene el nombre del bloque y los títulos de sus temas.
- Cada `tema_N.json` contiene las preguntas del tema `N` de ese bloque.
- Los directorios `generated/` y `examenes/` se ignoran; solo se importan los archivos `bloque_N/tema_N.json`.

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
    "explicacion": "Título IV, artículos 97 a 107."
  }
]
```

El número del directorio fija el bloque y el nombre del archivo fija el número del tema. Para ampliar el banco, añade más directorios `bloque_N/` con sus archivos `info.json` y `tema_N.json`.

## Configuración

| Variable | Por defecto | Para qué sirve |
|---|---|---|
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
