/* Arranca la app una vez para migrar el catálogo y TODOS los bancos a mano (7.7).
   Uso: OPIOS_DATOS=/ruta/de/datos bun scripts/migrar-bancos.js
   Antes de tocar nada guarda una instantánea de cada archivo (5.9). Si un banco tiene un
   esquema más nuevo que esta versión, lo deja intacto y avisa: hay que actualizar Opios. */
import { RUTA_CATALOGO } from "../src/config-servidor.js";
import { MIGRACIONES } from "../src/db/esquema.js";
import { DatabaseManager } from "../src/gestor-bancos.js";
import { almacenBun } from "../src/almacen-bun.js";
import { driverBun } from "../src/driver-bun.js";
import { ejecutarCli } from "../src/cli.js";

await ejecutarCli(async () => {
    if (!RUTA_CATALOGO) throw new Error("Define OPIOS_DATOS (o OPIOS_CATALOGO) para migrar los bancos.");
    const gestor = new DatabaseManager({ almacen: almacenBun, driver: driverBun, rutaCatalogo: RUTA_CATALOGO });
    try {
        const bancos = await gestor.listar();
        if (!bancos.length) return console.log("El catálogo no tiene bancos: nada que migrar.");
        for (const b of bancos) {
            if (!b.disponible) {
                console.log(`AVISO: «${b.nombre}» no está accesible (${b.ruta}); se omite.`);
                continue;
            }
            const db = await driverBun.abrir(almacenBun, b.ruta, { readonly: true });
            const version = driverBun.userVersion(db);
            db.close();
            if (version > MIGRACIONES.length) {
                console.log(
                    `AVISO: «${b.nombre}» está en v${version} (esta Opios conoce hasta v${MIGRACIONES.length}). Actualiza Opios; banco intacto.`,
                );
                continue;
            }
            if (version === MIGRACIONES.length) {
                console.log(`«${b.nombre}» ya está en v${version}.`);
                continue;
            }
            await gestor.instantanea(b.ruta); // 5.9: copia previa antes de migrar
            await gestor.abrir(b.ruta); // abrirRepo aplica las migraciones pendientes
            await gestor.cerrarBanco();
            console.log(`«${b.nombre}» migrado de v${version} a v${MIGRACIONES.length}.`);
        }
        await gestor.persistir();
    } finally {
        await gestor.close();
    }
});
