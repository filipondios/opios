/* bun run backup [archivo]  ->  copia consistente de data/opios.db con VACUUM INTO.
   Restaurar: para la app y copia el archivo sobre data/opios.db (o arranca con OPIOS_DB=<archivo>). */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { abrirDb } from "../src/db.js";
import { DB_PATH } from "../src/config.js";
import { copiaSeguridad } from "../src/backup.js";
import { ejecutarCli } from "../src/cli.js";

const sello = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
const destino = resolve(process.argv[2] ?? join(dirname(DB_PATH), `opios-${sello}.db`));

await ejecutarCli(async () => {
    if (!existsSync(DB_PATH)) {
        console.error(`No existe la base de datos ${DB_PATH}. Arranca la app o ejecuta bun run seed primero.`);
        process.exitCode = 1;
        return;
    }
    const repo = abrirDb();
    try {
        copiaSeguridad(repo.db, destino);
        console.log(`Copia guardada en ${destino}`);
    } finally {
        repo.close();
    }
});
