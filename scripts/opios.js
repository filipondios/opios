/* bun run opios exportar <banco.db> <destino.opios> [nombre]
   bun run opios importar <origen.opios> [destino.db]
   Exporta o restaura un banco portable .opios (manifest + SQLite). */
import { join } from "node:path";
import { RUTA_CATALOGO } from "../src/config.js";
import { exportarBanco, importarBancoOpios } from "../src/portable.js";
import { ejecutarCli } from "../src/cli.js";

await ejecutarCli(async () => {
    const [comando, ...args] = process.argv.slice(2);
    if (comando === "exportar" && args.length >= 2) {
        const m = exportarBanco(args[0], args[1], { nombre: args[2] });
        return console.log(`Exportado ${args[1]}: formato ${m.formato}, ${m.preguntas} pregunta(s).`);
    }
    if (comando === "importar" && args.length >= 1) {
        const destino = args[1] ?? (RUTA_CATALOGO ? join(RUTA_CATALOGO, "..", "restaurado.db") : "banco-restaurado.db");
        const m = importarBancoOpios(args[0], destino);
        return console.log(
            `Restaurado ${destino}: ${m.preguntas} pregunta(s), esquema v${m.user_version} (regístralo con «bun run bancos registrar»).`,
        );
    }
    console.error("Uso: bun run opios exportar <banco.db> <destino.opios> [nombre] | importar <origen.opios> [destino.db]");
    process.exit(1);
});
