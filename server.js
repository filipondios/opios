import { abrirDb } from "./src/db.js";
import { crearApp } from "./src/app.js";
import { idBanco } from "./src/banco-id.js";
import { importarDirectorio } from "./src/seed-directorio.js";
import { DatabaseManager } from "./src/gestor-bancos.js";
import { ErrorApi } from "./src/errores.js";
import { almacenBun } from "./src/almacen-bun.js";
import { driverBun } from "./src/driver-bun.js";
import {
    APP_TZ,
    AUTH,
    DB_PATH,
    DIR_EJEMPLO,
    DIR_PREGUNTAS,
    HOST,
    PORT,
    ALLOWED_HOSTS,
    OPIOS_SEED,
    RUTA_CATALOGO,
} from "./src/config-servidor.js";
import { MAX_SUBIDA, debeImportar } from "./src/config.js";

/* Registro con fecha en cada línea. */
const log = (...a) => console.log(new Date().toISOString(), ...a);
const logErr = (...a) => console.error(new Date().toISOString(), ...a);

/* Modo biblioteca (task 6): con OPIOS_CATALOGO se abre el banco activo del catálogo.
   Por defecto sigue el modo directo `OPIOS_DB` (legacy), igual que los scripts CLI. */
let repo,
    gestor = null;
/* En modo biblioteca la app se construye una vez, pero el banco activo puede cambiar en
   caliente (POST /api/bancos/:id/activar). `repoActual` es el banco abierto y `repo` un
   proxy que resuelve cada llamada contra él: la app no necesita reconstruirse. */
let repoActual = null,
    nombreBancoActual = null;
try {
    if (RUTA_CATALOGO) {
        gestor = new DatabaseManager({ almacen: almacenBun, driver: driverBun, rutaCatalogo: RUTA_CATALOGO });
        if (!(await gestor.idActivo())) {
            logErr(
                `El catálogo ${RUTA_CATALOGO} no tiene banco activo. ` +
                    "Elige uno con: bun run bancos listar && bun run bancos activar <id>",
            );
            await gestor.close();
            process.exit(1);
        }
        /* F3.8: si el archivo del banco activo no está (disco externo, archivo movido), el
           servidor arranca igual; la biblioteca sirve para Localizar o activar otro banco. */
        try {
            repoActual = await gestor.abrirActivo();
        } catch (e) {
            logErr(`El banco activo no está disponible: ${e.message}`);
            logErr("El servidor arranca igual: usa /biblioteca para localizar el archivo o activar otro banco.");
        }
        nombreBancoActual = await gestor.nombreActivo();
        repo = new Proxy(
            {},
            {
                get: (_, k) => {
                    if (!repoActual)
                        throw new ErrorApi(
                            503,
                            "El banco activo no está disponible: localiza su archivo o activa otro banco en /biblioteca.",
                        );
                    const v = repoActual[k];
                    return typeof v === "function" ? v.bind(repoActual) : v;
                },
            },
        );
        log(`Modo biblioteca: banco activo ${await gestor.rutaActiva()} (catálogo: ${RUTA_CATALOGO})`);
    } else {
        repo = abrirDb(DB_PATH);
    }
} catch (e) {
    logErr(`No se pudo abrir la base de datos: ${e.message}`);
    process.exit(1);
}

/* Importación del banco al arrancar (Fase 8.2). El modo lo decide `OPIOS_SEED`. Con el banco
   activo ausente (F3.8) no hay conexión: se omite la siembra y el servidor sigue arriba. */
const hayVariable = Boolean((process.env.OPIOS_PREGUNTAS ?? "").trim());
let bdVacia = true;
try {
    bdVacia = repo.contarPreguntas() === 0;
} catch (e) {
    if (!(e instanceof ErrorApi)) throw e;
}
log(`Banco de preguntas: ${DIR_PREGUNTAS}`);
try {
    if (debeImportar(OPIOS_SEED, bdVacia, hayVariable)) {
        /* `auto` actualiza por `id_externo` para no duplicar al editar el banco. */
        const r = await importarDirectorio(repo, DIR_PREGUNTAS, { actualizar: OPIOS_SEED === "auto" });
        log(
            `Importación (OPIOS_SEED=${OPIOS_SEED}): ${r.archivos} archivo(s), ${r.nuevas} nuevas, ` +
                `${r.duplicadas} duplicadas, ${r.actualizadas ?? 0} actualizadas.`,
        );
        for (const e of r.errores) logErr("  error:", e);
        for (const a of r.avisos ?? []) log("  aviso:", a);
    } else if (OPIOS_SEED === "auto" && !hayVariable && !bdVacia) {
        log(
            "OPIOS_SEED=auto sin OPIOS_PREGUNTAS: la BD ya tiene preguntas, no se importa " +
                "(define OPIOS_PREGUNTAS para sembrar automáticamente).",
        );
    }
} catch (e) {
    /* Solo el «banco no disponible» se tolera; los datos rotos siguen siendo fatales. */
    if (gestor && e instanceof ErrorApi) {
        logErr(`Importación omitida: ${e.message}`);
    } else {
        logErr(`Error al importar el banco: ${e.message}`);
        repo.close();
        process.exit(1);
    }
}

const servidor = Bun.serve({
    hostname: HOST,
    port: PORT,
    /* El cuerpo máximo se corta antes de leerlo entero (Fase 2.9). El límite fino por
       tipo de cuerpo lo hace la API: MAX_CUERPO para JSON, MAX_SUBIDA para archivos (F3.4). */
    maxRequestBodySize: MAX_SUBIDA,
    fetch: crearApp(repo, {
        auth: AUTH,
        zona: APP_TZ,
        /* El id/nombre del banco activo van al cliente en cada página (F1.5/F3.3); en modo
           biblioteca se leen por petición porque el activo puede cambiar en caliente. */
        banco: gestor ? () => (repoActual ? idBanco(repoActual) : null) : idBanco(repo),
        bancoNombre: gestor ? () => nombreBancoActual : null,
        gestor,
        dirPreguntas: DIR_PREGUNTAS,
        dirEjemplo: DIR_EJEMPLO,
        alActivar: gestor
            ? async (nuevo) => {
                  repoActual = nuevo;
                  nombreBancoActual = await gestor.nombreActivo();
              }
            : null,
    }),
});
if (!AUTH && HOST !== "127.0.0.1" && HOST !== "localhost")
    log("AVISO: la app es accesible desde fuera y no tiene contraseña (define AUTH_USER y AUTH_PASS).");
log(`Test infinito en ${servidor.url}  (base de datos: ${gestor ? await gestor.rutaActiva() : DB_PATH})`);
log(`Hosts aceptados: ${ALLOWED_HOSTS.join(", ")}`);

/* Cierre ordenado: deja de aceptar conexiones y después cierra la base de datos. */
let cerrando = false;
async function cerrar(senal) {
    if (cerrando) return;
    cerrando = true;
    log(`Recibida señal ${senal}: cerrando...`);
    try {
        await servidor.stop(true);
    } catch (e) {
        logErr("Error al parar el servidor:", e);
    }
    if (gestor) {
        /* 5.10: el gestor hace flush + wal_checkpoint(TRUNCATE) + cierre del banco abierto
           y del catálogo. Llamar además a repo.close() aquí cerraría la conexión antes del
           volcado y perdería el checkpoint. */
        try {
            await gestor.close();
        } catch (e) {
            logErr("Error al cerrar la base de datos:", e);
        }
    } else {
        /* Modo directo (legacy): no hay gestor que lo haga. */
        try {
            driverBun.puntoControl(repo.db);
        } catch (e) {
            logErr("Error al hacer checkpoint de la base de datos:", e);
        }
        try {
            repo.close();
        } catch (e) {
            logErr("Error al cerrar la base de datos:", e);
        }
    }
    log("Cerrado correctamente.");
    process.exit(0);
}
process.on("SIGINT", () => cerrar("SIGINT"));
process.on("SIGTERM", () => cerrar("SIGTERM"));
process.on("uncaughtException", (e) => logErr("Error no capturado:", e));
process.on("unhandledRejection", (e) => logErr("Promesa rechazada:", e));
