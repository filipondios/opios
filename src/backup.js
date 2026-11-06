import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Copia consistente de la base de datos con `VACUUM INTO`.
 * Incluye esquema, preguntas, progreso y simulacros (a diferencia de `export`, que solo vuelca preguntas).
 */
export function copiaSeguridad(db, destino) {
  if (existsSync(destino)) throw new Error(`Ya existe ${destino}; elige otro nombre.`);
  mkdirSync(dirname(destino), { recursive: true });
  /* La ruta va entre comillas simples: hay que duplicar las comillas internas. */
  db.run(`VACUUM INTO '${destino.replaceAll("'", "''")}'`);
  return destino;
}
