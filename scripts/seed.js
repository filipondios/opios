/* bun run seed [directorio] [--actualizar]
   Importa los JSON de preguntas/ (u otro directorio) a la DB. Se puede repetir sin duplicar.
   Con --actualizar, las preguntas que traen `id_externo` se actualizan conservando su id y progreso. */
import { abrirDb } from "../src/db.js";
import { importarDirectorio } from "../src/seed.js";
import { DIR_PREGUNTAS } from "../src/config.js";

const args = process.argv.slice(2);
const actualizar = args.includes("--actualizar");
const dir = args.find((a) => !a.startsWith("--")) ?? DIR_PREGUNTAS;

const repo = abrirDb();
console.log(`Banco de preguntas: ${dir}`);
const r = await importarDirectorio(repo, dir, { actualizar });
console.log(`${r.archivos} archivo(s): ${r.nuevas} nuevas, ${r.duplicadas} ya existentes, ${r.actualizadas ?? 0} actualizadas.`);
for (const e of r.errores) console.error("error:", e);
for (const a of r.avisos ?? []) console.warn("aviso:", a);
repo.close();
process.exit(r.errores.length ? 1 : 0);
