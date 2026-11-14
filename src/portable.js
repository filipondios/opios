/* Banco portable `.opios` (task 8 del TODO): gzip de un contenedor propio con
   cabecera (formato + manifest) y la SQLite del banco. Sin dependencias: cabecera
   "opios-banco\0" + uint32 LE con el tamaño del manifest + manifest JSON + bytes SQLite.
   La SQLite se saca con `VACUUM INTO` (copia consistente aunque haya conexiones abiertas).
   La importación valida cabecera, versión y SQLite (integridad + esquema) y escribe con
   temporal + rename: el destino queda completo o no existe. */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { copiaSeguridad } from "./backup.js";
import { validarBancoSqlite } from "./db/validar-sqlite.js";

/** Borrar una SQLite junto a sus sidecars WAL/SHM (si quedaran huérfanos). */
function borrarBanco(ruta) {
    rmSync(ruta, { force: true });
    for (const lado of ["-wal", "-shm"]) rmSync(ruta + lado, { force: true });
}

const MAGICA = Buffer.from("opios-banco\0", "utf8");
export const FORMATO = 1;

function contenedor(manifest, sqlite) {
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
    const cabecera = Buffer.alloc(MAGICA.length + 4);
    MAGICA.copy(cabecera, 0);
    cabecera.writeUInt32LE(manifestBuf.length, MAGICA.length);
    return Buffer.concat([cabecera, manifestBuf, sqlite]);
}

function descontenedor(buf) {
    if (buf.length < MAGICA.length + 4 || !buf.subarray(0, MAGICA.length).equals(MAGICA))
        throw new Error("No es un banco .opios (cabecera no reconocida).");
    const tam = buf.readUInt32LE(MAGICA.length);
    const fin = MAGICA.length + 4 + tam;
    if (fin > buf.length) throw new Error("Archivo .opios incompleto (falta el manifest o la SQLite).");
    let manifest;
    try {
        manifest = JSON.parse(buf.subarray(MAGICA.length + 4, fin).toString("utf8"));
    } catch {
        throw new Error("Manifest del banco .opios no válido (JSON roto).");
    }
    if (!manifest || manifest.formato !== FORMATO)
        throw new Error(
            `Formato ${manifest?.formato} no soportado: esta versión de Opios lee el formato ${FORMATO}.`,
        );
    return { manifest, sqlite: buf.subarray(fin) };
}

/** Crea `destino.opios` desde el banco en `rutaBanco`. Devuelve el manifest escrito. */
export function exportarBanco(rutaBanco, destino, { nombre } = {}) {
    if (existsSync(destino)) throw new Error(`Ya existe ${destino}; elige otro nombre.`);
    const temporal = destino + ".tmp";
    const instantanea = destino + ".snap";
    try {
        /* `VACUUM INTO` sobre una conexión solo lectura: copia consistente sin migrar el original. */
        const db = new Database(rutaBanco, { readonly: true, strict: true });
        try {
            copiaSeguridad(db, instantanea);
        } finally {
            db.close();
        }
        const info = validarBancoSqlite(instantanea);
        const manifest = {
            formato: FORMATO,
            app: "opios",
            nombre: nombre || rutaBanco.replaceAll("\\", "/").split("/").pop().replace(/\.db$/i, ""),
            creado: new Date().toISOString(),
            user_version: info.user_version,
            preguntas: info.preguntas,
        };
        const sqlite = readFileSync(instantanea);
        borrarBanco(instantanea);
        mkdirSync(dirname(destino), { recursive: true });
        writeFileSync(temporal, Bun.gzipSync(contenedor(manifest, sqlite)));
        renameSync(temporal, destino); // atómico: el .opios aparece completo o no aparece
        return manifest;
    } catch (e) {
        borrarBanco(temporal);
        borrarBanco(instantanea);
        throw e;
    }
}

/** Restaura un `.opios` a un banco SQLite en `destino`; devuelve el manifest. */
export function importarBancoOpios(origen, destino) {
    if (existsSync(destino)) throw new Error(`Ya existe ${destino}; elige otro nombre.`);
    const temporal = destino + ".tmp";
    try {
        let buf;
        try {
            buf = Buffer.from(Bun.gunzipSync(readFileSync(origen)));
        } catch {
            throw new Error(`No es un banco .opios válido (${origen}): no es gzip o está corrupto.`);
        }
        const { manifest, sqlite } = descontenedor(buf);
        mkdirSync(dirname(destino), { recursive: true });
        writeFileSync(temporal, sqlite);
        /* Validar el banco extraído ANTES de ocupar su destino definitivo. */
        const info = validarBancoSqlite(temporal);
        if (info.user_version !== manifest.user_version)
            throw new Error("El manifest y la SQLite no se corresponden (user_version distinta).");
        renameSync(temporal, destino);
        return { ...manifest, preguntas: info.preguntas };
    } catch (e) {
        borrarBanco(temporal);
        throw e;
    }
}
