/* Detección de archivos importables (F3.4): un solo sitio para la regla. Neutro de
   plataforma: solo Uint8Array (el WebView de Android lo reutiliza en F4.4). Orden de
   detección: gzip → contenedor .opios; cabecera SQLite; zip (PK); resto, JSON con una
   lista de preguntas. Lanza con un error en español y accionable si no es nada de eso. */
import { descomprimir, descontenedor } from "./portable.js";
import { fuenteMemoria } from "./fuente.js";

const MAGICA_SQLITE = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
const MAGICA_ZIP = [0x50, 0x4b, 0x03, 0x04]; // "PK\3\4"

const empiezaCon = (bytes, prefijo) => prefijo.every((b, i) => bytes[i] === b);

/** Fuente de un JSON importado (formato antiguo: lista suelta de preguntas). */
export const fuenteDeJson = (texto) => fuenteMemoria({ "importado.json": texto });

/**
 * Detecta qué es `bytes`. Devuelve:
 * - `{ tipo: "opios", sqlite, manifest }` — gzip + cabecera `opios-banco\0`; sqlite son los
 *   bytes de la base ya descomprimidos, manifest el del contenedor.
 * - `{ tipo: "sqlite", sqlite }` — una SQLite en crudo.
 * - `{ tipo: "zip" }` — detectado, pero la importación de zip llega con F4.4 (Android).
 * - `{ tipo: "json", texto, preguntas }` — lista de preguntas (array u objeto `{preguntas}`).
 */
export async function detectarArchivo(bytes) {
    if (!bytes || bytes.length < 4) throw new Error("El archivo está vacío o es demasiado corto para ser un banco.");
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        let buf;
        try {
            buf = await descomprimir(bytes);
        } catch {
            throw new Error(
                "Es un gzip corrupto o incompleto. Vuelve a exportar el banco o pídeselo a quien lo envió.",
            );
        }
        const { manifest, sqlite } = descontenedor(buf);
        return { tipo: "opios", sqlite, manifest };
    }
    if (empiezaCon(bytes, MAGICA_SQLITE)) return { tipo: "sqlite", sqlite: bytes };
    if (empiezaCon(bytes, MAGICA_ZIP))
        return { tipo: "zip", sqlite: null, manifest: null, texto: null, preguntas: null };
    const texto = new TextDecoder().decode(bytes);
    let datos;
    try {
        datos = JSON.parse(texto);
    } catch {
        throw new Error(
            "No se reconoce el archivo: no es .opios, ni SQLite, ni zip, ni JSON. Comprueba qué archivo elegiste.",
        );
    }
    const preguntas = Array.isArray(datos) ? datos : datos && Array.isArray(datos.preguntas) ? datos.preguntas : null;
    if (!preguntas) throw new Error("El JSON no contiene una lista de preguntas (un array o un objeto {preguntas}).");
    if (!preguntas.length) throw new Error("El JSON no tiene ninguna pregunta.");
    return { tipo: "json", sqlite: null, manifest: null, texto, preguntas };
}
