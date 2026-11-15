/* Lector de zip del asistente de importación (F4.4): un banco JSON comprimido. Solo lo
   imprescindible: directorio central, entradas sin comprimir o `deflate` (lo infla
   DecompressionStream, que existe en Bun, Node y el WebView). Sin zip64, cifrado ni
   multi-disco: si aparecen, error claro. */
import { RE_BLOQUE } from "./estructura-banco.js";
import { fuenteMemoria } from "./fuente.js";

const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;
const FIRMA_FIN = 0x06054b50;

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

async function inflar(bytes) {
    const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(flujo).arrayBuffer());
}

/** Devuelve Map<ruta, Uint8Array> con los archivos del zip. */
export async function leerZip(bytes) {
    /* El final del directorio central está al final, tras el comentario (máx. 64 KiB). */
    let fin = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--)
        if (u32(bytes, i) === FIRMA_FIN) {
            fin = i;
            break;
        }
    if (fin < 0) throw new Error("El .zip está corrupto o incompleto.");

    const total = u16(bytes, fin + 10);
    let p = u32(bytes, fin + 16);
    if (total === 0xffff || p === 0xffffffff) throw new Error("El .zip usa zip64, que no está soportado.");
    const archivos = new Map();
    for (let n = 0; n < total; n++) {
        if (u32(bytes, p) !== FIRMA_CENTRAL) throw new Error("El .zip está corrupto (directorio central).");
        const metodo = u16(bytes, p + 10);
        const comprimido = u32(bytes, p + 20);
        const sinComprimir = u32(bytes, p + 24);
        const largoNombre = u16(bytes, p + 28);
        const largoExtra = u16(bytes, p + 30);
        const largoComentario = u16(bytes, p + 32);
        const local = u32(bytes, p + 42);
        const nombre = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + largoNombre));
        p += 46 + largoNombre + largoExtra + largoComentario;
        if (comprimido === 0xffffffff || sinComprimir === 0xffffffff)
            throw new Error("El .zip usa zip64, que no está soportado.");
        if (nombre.endsWith("/")) continue; // entrada de carpeta
        if (u32(bytes, local) !== FIRMA_LOCAL) throw new Error("El .zip está corrupto (cabecera local).");
        /* La cabecera local repite nombre y extra con longitudes propias: se saltan. */
        const inicio = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
        if (inicio + comprimido > bytes.length) throw new Error("El .zip está corrupto (datos truncados).");
        const datos = bytes.subarray(inicio, inicio + comprimido);
        const contenido = metodo === 0 ? datos : metodo === 8 ? await inflar(datos) : null;
        if (!contenido) throw new Error(`El .zip usa una compresión no soportada (método ${metodo}).`);
        archivos.set(nombre.replace(/\\/g, "/"), contenido);
    }
    return archivos;
}

/** Fuente en memoria (F2.6) con los .json del zip, para `importarFuente`. Si el zip trae una
    única carpeta raíz («mi-banco/bloque_1/…»), se quita: la estructura empieza en la raíz. */
export async function fuenteDeZip(bytes) {
    const archivos = await leerZip(bytes);
    const textos = {};
    for (const [ruta, contenido] of archivos)
        if (ruta.toLowerCase().endsWith(".json")) textos[ruta] = new TextDecoder().decode(contenido);
    const rutas = Object.keys(textos);
    const primero = (r) => r.split("/")[0];
    if (rutas.length && !rutas.some((r) => RE_BLOQUE.test(primero(r)))) {
        const raiz = primero(rutas[0]);
        if (rutas.every((r) => primero(r) === raiz && r.includes("/"))) {
            const sinRaiz = {};
            for (const [r, t] of Object.entries(textos)) sinRaiz[r.slice(raiz.length + 1)] = t;
            return fuenteMemoria(sinRaiz);
        }
    }
    return fuenteMemoria(textos);
}
