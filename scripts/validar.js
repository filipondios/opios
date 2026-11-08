/* bun run validar [directorio]
   Comprueba un banco de preguntas sin tocar tu base de datos: importa en una BD en memoria y
   lista los errores y los avisos. Sale con código 1 si hay errores (útil en el CI del banco). */
import { abrirDb } from "../src/db.js";
import { DIR_PREGUNTAS } from "../src/config.js";
import { validarBanco } from "../src/validar-banco.js";

const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? DIR_PREGUNTAS;

const repo = abrirDb(":memory:");
const r = await validarBanco(repo, dir);
repo.close();

console.log(`Validando el banco: ${dir}`);
console.log(`  ${r.archivos} archivo(s): ${r.nuevas} preguntas, ${r.duplicadas} duplicadas, ${r.actualizadas} actualizadas.`);
for (const a of r.avisos) console.warn("aviso:", a);
for (const e of r.errores) console.error("error:", e);

if (r.errores.length) {
  console.error(`\n${r.errores.length} error(es): el banco no es válido.`);
  process.exit(1);
}
console.log(`\nSin errores${r.avisos.length ? ` (${r.avisos.length} aviso(s))` : ""}.`);
