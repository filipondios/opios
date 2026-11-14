/* Reexporta la implementación dividida de `src/db/`. Mantiene la API pública.
   `abrirDb` es la conexión Bun; el repo (`abrirRepo`) es independiente del driver. */
export { abrirDb } from "./db/bun.js";
export { abrirRepo } from "./db/index.js";
