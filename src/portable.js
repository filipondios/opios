/* Banco portable `.opios` (task 8 del TODO, F2.5): gzip de un contenedor propio con cabecera
   (formato + manifest) y la SQLite del banco. Neutro de plataforma: solo Uint8Array y
   CompressionStream/DecompressionStream (presentes en Bun, Node y el WebView de Android);
   sin Buffer, sin Bun.gzip y sin node:fs. Cabecera "opios-banco\0" + uint32 LE con el
   tamaño del manifest + manifest JSON + bytes SQLite. `exportarBanco` valida la conexión
   (F2.4) antes de empaquetar y usa la instantánea del driver (copia consistente);
   `importarBancoOpios` valida lo extraído y escribe con temporal + renombrar: el destino
   queda completo o no existe. */
import { errorDeVerificacion, verificarBanco } from "./db/validar-sqlite.js";

export const FORMATO = 1;
const CODIFICADOR = new TextEncoder();
const DECODIFICADOR = new TextDecoder();
const MAGICA = CODIFICADOR.encode("opios-banco\0");

export function contenedor(manifest, sqlite) {
    const manifestBytes = CODIFICADOR.encode(JSON.stringify(manifest, null, 2));
    const cabecera = new Uint8Array(MAGICA.length + 4);
    cabecera.set(MAGICA);
    new DataView(cabecera.buffer).setUint32(MAGICA.length, manifestBytes.length, true);
    const todo = new Uint8Array(cabecera.length + manifestBytes.length + sqlite.length);
    todo.set(cabecera, 0);
    todo.set(manifestBytes, cabecera.length);
    todo.set(sqlite, cabecera.length + manifestBytes.length);
    return todo;
}

const empiezaCon = (bytes, prefijo) => prefijo.every((b, i) => bytes[i] === b);

export function descontenedor(bytes) {
    if (bytes.length < MAGICA.length + 4 || !empiezaCon(bytes, MAGICA))
        throw new Error("No es un banco .opios (cabecera no reconocida).");
    const tam = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGICA.length, true);
    const fin = MAGICA.length + 4 + tam;
    if (fin > bytes.length) throw new Error("Archivo .opios incompleto (falta el manifest o la SQLite).");
    let manifest;
    try {
        manifest = JSON.parse(DECODIFICADOR.decode(bytes.subarray(MAGICA.length + 4, fin)));
    } catch {
        throw new Error("Manifest del banco .opios no válido (JSON roto).");
    }
    if (!manifest || manifest.formato !== FORMATO)
        throw new Error(`Formato ${manifest?.formato} no soportado: esta versión de Opios lee el formato ${FORMATO}.`);
    return { manifest, sqlite: bytes.subarray(fin) };
}

/* gzip estándar con los streams de compresión de la plataforma. */
async function gzip(bytes, Clase) {
    const salida = new Blob([bytes]).stream().pipeThrough(new Clase("gzip"));
    return new Uint8Array(await new Response(salida).arrayBuffer());
}

export const comprimir = (bytes) => gzip(bytes, CompressionStream);
export const descomprimir = (bytes) => gzip(bytes, DecompressionStream);

/* Vacía el progreso personal de una COPIA de banco (F5.5): repaso, respuestas, simulacros
   y ajustes, conservando la identidad (`uuid_banco`, que sirve para detectar duplicados).
   No lo llames sobre el banco real: escribe. */
export function vaciarProgreso(db) {
    for (const tabla of ["progreso", "respuestas", "simulacros"]) db.run(`DELETE FROM ${tabla}`);
    db.run("DELETE FROM ajustes WHERE clave <> 'uuid_banco'");
}

/** Empaqueta el banco abierto con `driver` (Bun o sql.js) en bytes .opios. Verifica la
    conexión antes (F2.4) y usa la instantánea del driver (copia consistente y compacta).
    Con `incluyeProgreso: false` quien llama debe pasar una copia sin progreso (F5.5).
    Devuelve { bytes, manifest }. */
export async function exportarBanco(driver, db, { nombre = "banco", incluyeProgreso = true } = {}) {
    let info;
    try {
        info = verificarBanco(db);
    } catch (e) {
        throw errorDeVerificacion(e);
    }
    const manifest = {
        formato: FORMATO,
        app: "opios",
        nombre,
        creado: new Date().toISOString(),
        user_version: info.user_version,
        preguntas: info.preguntas,
        incluye_progreso: incluyeProgreso,
    };
    return { bytes: await comprimir(contenedor(manifest, driver.instantanea(db))), manifest };
}

/** Restaura bytes .opios como banco SQLite en `destino` (vía almacén + driver); devuelve
    el manifest. Si el destino existía, lo pisa el que llama (el CLI y la API lo comprueban). */
export async function importarBancoOpios(driver, almacen, destino, paquete) {
    let buf;
    try {
        buf = await descomprimir(paquete);
    } catch {
        throw new Error(`No es un banco .opios válido (${destino}): no es gzip o está corrupto.`);
    }
    const { manifest, sqlite } = descontenedor(buf);
    const temporal = destino + ".tmp";
    try {
        await almacen.escribir(temporal, sqlite);
        /* Validar el banco extraído ANTES de ocupar su destino definitivo (F2.4). */
        const db = await driver.abrir(almacen, temporal, { readonly: true });
        let info;
        try {
            info = verificarBanco(db);
        } catch (e) {
            throw errorDeVerificacion(e, temporal);
        } finally {
            db.close();
        }
        if (info.user_version !== manifest.user_version)
            throw new Error("El manifest y la SQLite no se corresponden (user_version distinta).");
        for (const lado of ["-wal", "-shm"]) await almacen.borrar(temporal + lado);
        await almacen.renombrar(temporal, destino); // atómico dentro del mismo directorio
        return { ...manifest, preguntas: info.preguntas };
    } catch (e) {
        for (const lado of ["", "-wal", "-shm"]) await almacen.borrar(temporal + lado);
        throw e;
    }
}
