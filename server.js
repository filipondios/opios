import { abrirDb } from "./src/db.js";
import { crearApp } from "./src/app.js";
import { importarDirectorio } from "./src/seed.js";
import { AUTH, DB_PATH, DIR_PREGUNTAS, HOST, PORT, ALLOWED_HOSTS } from "./src/config.js";

/* Registro con fecha en cada línea. */
const log = (...a) => console.log(new Date().toISOString(), ...a);
const logErr = (...a) => console.error(new Date().toISOString(), ...a);

const repo = abrirDb(DB_PATH);

// Primera ejecución: si la DB está vacía, se cargan los JSON de preguntas/.
if (repo.contarPreguntas() === 0) {
  const r = await importarDirectorio(repo, DIR_PREGUNTAS);
  log(`DB vacía: importadas ${r.nuevas} preguntas desde ${r.archivos} archivo(s) de preguntas/.`);
  for (const e of r.errores) log("  aviso:", e);
  for (const a of r.avisos ?? []) log("  aviso:", a);
}

const servidor = Bun.serve({ hostname: HOST, port: PORT, fetch: crearApp(repo, { auth: AUTH }) });
if (!AUTH && HOST !== "127.0.0.1" && HOST !== "localhost") log("AVISO: la app es accesible desde fuera y no tiene contraseña (define AUTH_USER y AUTH_PASS).");
log(`Test infinito en ${servidor.url}  (base de datos: ${DB_PATH})`);
log(`Hosts aceptados: ${ALLOWED_HOSTS.join(", ")}`);

/* Cierre ordenado: deja de aceptar conexiones y después cierra la base de datos. */
let cerrando = false;
async function cerrar(senal) {
  if (cerrando) return;
  cerrando = true;
  log(`Recibida señal ${senal}: cerrando...`);
  try { await servidor.stop(true); } catch (e) { logErr("Error al parar el servidor:", e); }
  try { repo.close(); } catch (e) { logErr("Error al cerrar la base de datos:", e); }
  log("Cerrado correctamente.");
  process.exit(0);
}
process.on("SIGINT", () => cerrar("SIGINT"));
process.on("SIGTERM", () => cerrar("SIGTERM"));
process.on("uncaughtException", (e) => logErr("Error no capturado:", e));
process.on("unhandledRejection", (e) => logErr("Promesa rechazada:", e));
