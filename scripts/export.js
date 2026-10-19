/* bun run export [archivo.json]  ->  vuelca todas las preguntas en el formato JSON antiguo (a stdout si no se indica archivo). */
import { abrirDb } from "../src/db.js";
import { serializarJson } from "../src/exportar.js";

const repo = abrirDb();
const texto = serializarJson(repo.todas());
repo.close();
const destino = process.argv[2];
if (destino) { await Bun.write(destino, texto); console.log(`Preguntas guardadas en ${destino}`); }
else process.stdout.write(texto);
