/* Copia completa `.opios-backup` (F5.6): un zip con `manifest.json` y los `.opios` (F2.5) de
   cada banco. Neutro de plataforma: reutiliza los primitivos zip (`crearZip`/`leerZip`).
   `formato: 1`, compatible hacia delante: el lector rechaza formatos que no conoce. */
import { crearZip, leerZip } from "./banco-zip.js";

export const FORMATO_COPIA = 1;
const DECODIFICADOR = new TextDecoder();

/** Empaqueta los bancos (cada uno `{ archivo, manifest, bytes }`, donde `bytes` es un .opios)
    en un zip con `manifest.json`. Devuelve { bytes, manifest }. */
export function empaquetarCopia(bancos, { creado = new Date().toISOString() } = {}) {
    const manifest = {
        formato: FORMATO_COPIA,
        app: "opios",
        creado,
        bancos: bancos.map(({ archivo, manifest: m }) => ({
            archivo,
            nombre: m.nombre,
            preguntas: m.preguntas,
            user_version: m.user_version,
        })),
    };
    const entradas = { "manifest.json": JSON.stringify(manifest, null, 2) };
    for (const b of bancos) entradas[b.archivo] = b.bytes;
    return { bytes: crearZip(entradas), manifest };
}

/** Lee un `.opios-backup`: devuelve { manifest, bancos: [{ archivo, nombre, bytes }] }. */
export async function leerCopia(bytes) {
    let archivos;
    try {
        archivos = await leerZip(bytes);
    } catch (e) {
        throw new Error(`No es una copia de Opios (.opios-backup): ${e.message}`);
    }
    const bruto = archivos.get("manifest.json");
    if (!bruto) throw new Error("No es una copia de Opios: falta manifest.json.");
    let manifest;
    try {
        manifest = JSON.parse(DECODIFICADOR.decode(bruto));
    } catch {
        throw new Error("El manifest de la copia está roto (JSON no válido).");
    }
    if (manifest?.formato !== FORMATO_COPIA)
        throw new Error(
            `Copia de formato ${manifest?.formato} no soportado: esta versión de Opios lee el ${FORMATO_COPIA}.`,
        );
    const bancos = [];
    for (const b of manifest.bancos ?? []) {
        const datos = archivos.get(b.archivo);
        if (!datos) throw new Error(`La copia no contiene el banco «${b.archivo}».`);
        bancos.push({ archivo: b.archivo, nombre: b.nombre ?? b.archivo, bytes: datos });
    }
    return { manifest, bancos };
}
