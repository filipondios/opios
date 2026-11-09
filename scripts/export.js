/* bun run export [archivo.json]              ->  vuelca todas las preguntas en el formato JSON antiguo.
   bun run export --por-bloques <directorio>  ->  escribe bloque_X/info.json y bloque_X/tema_N.json. */
import { abrirDb } from "../src/db.js";
import { exportarPorBloques, serializarJson } from "../src/exportar.js";
import { ejecutarCli } from "../src/cli.js";

await ejecutarCli(async () => {
    const repo = abrirDb();
    try {
        if (process.argv[2] === "--por-bloques") {
            const dir = process.argv[3];
            if (!dir) {
                console.error("Falta el directorio de destino: bun run export --por-bloques <directorio>");
                process.exitCode = 1;
                return;
            }
            const r = await exportarPorBloques(repo, dir);
            console.log(`${r.bloques} bloque(s), ${r.archivos} archivo(s), ${r.preguntas} pregunta(s) en ${dir}`);
            if (r.omitidas) console.warn(`aviso: ${r.omitidas} pregunta(s) sin bloque no se han exportado.`);
            return;
        }

        const texto = serializarJson(repo.todas());
        const destino = process.argv[2];
        if (destino) {
            await Bun.write(destino, texto);
            console.log(`Preguntas guardadas en ${destino}`);
        } else process.stdout.write(texto);
    } finally {
        repo.close();
    }
});
