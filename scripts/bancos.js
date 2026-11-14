/* bun run bancos listar
   bun run bancos registrar <nombre> <ruta-banco.db>
   bun run bancos activar <id>
   bun run bancos importar <nombre> <directorio-json>
   bun run bancos copiar <nombre> <ruta-origen.db>
   bun run bancos actualizar <directorio-json>
   Gestiona el catálogo del modo biblioteca. Requiere OPIOS_CATALOGO. */
import { RUTA_CATALOGO } from "../src/config.js";
import { DatabaseManager } from "../src/gestor-bancos.js";
import { ejecutarCli } from "../src/cli.js";

await ejecutarCli(async () => {
    if (!RUTA_CATALOGO) {
        console.error("error: define OPIOS_CATALOGO (ruta del catálogo) para usar el modo biblioteca.");
        process.exit(1);
    }
    const [comando, ...args] = process.argv.slice(2);
    const gestor = new DatabaseManager(RUTA_CATALOGO);
    try {
        if (comando === "listar" && args.length === 0) {
            const activo = gestor.idActivo();
            const filas = gestor.listar();
            if (!filas.length) return console.log("Catálogo vacío: registra un banco con «bun run bancos registrar».");
            for (const b of filas)
                console.log(
                    `${b.activo ? "*" : " "} ${b.id}  ${b.nombre}  ${b.ruta}${b.id === activo ? "  (activo)" : ""}`,
                );
            return;
        }
        if (comando === "registrar" && args.length === 2) {
            const b = gestor.registrar(args[0], args[1]);
            return console.log(`Registrado: ${b.id} ${b.nombre} -> ${b.ruta}`);
        }
        if (comando === "activar" && args.length === 1) {
            gestor.activar(Number(args[0]));
            return console.log(`Banco activo: ${args[0]} (${gestor.rutaActiva()})`);
        }
        if (comando === "importar" && args.length === 2) {
            const b = await gestor.importarJson(args[0], args[1]);
            return console.log(`Creado: ${b.id} ${b.nombre} -> ${b.ruta}`);
        }
        if (comando === "copiar" && args.length === 2) {
            const b = gestor.copiar(args[0], args[1]);
            return console.log(`Copiado: ${b.id} ${b.nombre} -> ${b.ruta}`);
        }
        if (comando === "actualizar" && args.length === 1) {
            const r = await gestor.actualizarActivo(args[0]);
            console.log(
                `Banco actualizado (${r.banco}): ${r.archivos} archivo(s), ${r.nuevas} nuevas, ` +
                    `${r.duplicadas} duplicadas, ${r.actualizadas} actualizadas.`,
            );
            for (const a of r.avisos) console.log("  aviso:", a);
            return;
        }
        console.error("Uso: bun run bancos listar | registrar <nombre> <ruta> | activar <id> | importar <nombre> <dir> | copiar <nombre> <ruta> | actualizar <dir>");
        process.exit(1);
    } finally {
        gestor.close();
    }
});
