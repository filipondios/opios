/* bun run seed [directorio]  ->  importa los JSON de preguntas/ (u otro directorio) a la DB. Se pueden repetir sin duplicar. */
import { abrirDb } from "../src/db.js";
import { importarDirectorio } from "../src/seed.js";
import { DIR_PREGUNTAS } from "../src/config.js";

const repo = abrirDb();
const r = await importarDirectorio(repo, process.argv[2] ?? DIR_PREGUNTAS);
console.log(`${r.archivos} archivo(s): ${r.nuevas} preguntas nuevas, ${r.duplicadas} ya existentes.`);
for (const e of r.errores) console.error("error:", e);
repo.close();
process.exit(r.errores.length ? 1 : 0);
