import { abrirDb } from "./src/db.js";
import { crearApp } from "./src/app.js";
import { importarDirectorio } from "./src/seed.js";
import { DB_PATH, DIR_PREGUNTAS, HOST, PORT } from "./src/config.js";

const repo = abrirDb(DB_PATH);

// Primera ejecución: si la DB está vacía, se cargan los JSON de preguntas/.
if (repo.contarPreguntas() === 0) {
  const r = await importarDirectorio(repo, DIR_PREGUNTAS);
  console.log(`DB vacía: importadas ${r.nuevas} preguntas desde ${r.archivos} archivo(s) de preguntas/.`);
  for (const e of r.errores) console.warn("  aviso:", e);
}

const servidor = Bun.serve({ hostname: HOST, port: PORT, fetch: crearApp(repo) });
console.log(`Test infinito en ${servidor.url}  (base de datos: ${DB_PATH})`);

process.on("SIGINT", () => { repo.close(); process.exit(0); });
process.on("SIGTERM", () => { repo.close(); process.exit(0); });
