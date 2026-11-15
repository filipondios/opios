/* bun run opios exportar <banco.db> <destino.opios> [nombre]
   bun run opios importar <origen.opios> [destino.db]
   Exporta o restaura un banco portable .opios (manifest + SQLite). Solo PC: usa el driver
   y el almacén de Bun; el núcleo (src/portable.js) es neutro de plataforma. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { almacenBun } from "../src/almacen-bun.js";
import { driverBun } from "../src/driver-bun.js";
import { RUTA_CATALOGO } from "../src/config-servidor.js";
import { exportarBanco, importarBancoOpios } from "../src/portable.js";
import { ejecutarCli } from "../src/cli.js";

await ejecutarCli(async () => {
    const [comando, ...args] = process.argv.slice(2);
    if (comando === "exportar" && args.length >= 2) {
        const [banco, destino, nombre] = args;
        if (existsSync(destino)) throw new Error(`Ya existe ${destino}; elige otro nombre.`);
        const db = await driverBun.abrir(almacenBun, banco, { readonly: true });
        let paquete;
        try {
            paquete = await exportarBanco(driverBun, db, { nombre });
        } finally {
            db.close();
        }
        mkdirSync(dirname(destino), { recursive: true });
        writeFileSync(destino, paquete.bytes);
        const m = paquete.manifest;
        return console.log(`Exportado ${destino}: formato ${m.formato}, ${m.preguntas} pregunta(s).`);
    }
    if (comando === "importar" && args.length >= 1) {
        const destino = args[1] ?? (RUTA_CATALOGO ? join(RUTA_CATALOGO, "..", "restaurado.db") : "banco-restaurado.db");
        const m = await importarBancoOpios(driverBun, almacenBun, destino, new Uint8Array(readFileSync(args[0])));
        return console.log(
            `Restaurado ${destino}: ${m.preguntas} pregunta(s), esquema v${m.user_version} (regístralo con «bun run bancos registrar»).`,
        );
    }
    console.error(
        "Uso: bun run opios exportar <banco.db> <destino.opios> [nombre] | importar <origen.opios> [destino.db]",
    );
    process.exit(1);
});
