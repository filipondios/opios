/* Lector de zip (F4.4): un banco JSON comprimido, como el que se comparte por correo o
   mensajería. El zip de prueba se construye aquí mismo (sin dependencias). */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectarArchivo } from "../src/banco-archivo.js";
import { fuenteDeZip, leerZip } from "../src/banco-zip.js";
import { DatabaseManager } from "../src/gestor-bancos.js";
import { almacenBun } from "../src/almacen-bun.js";
import { driverBun } from "../src/driver-bun.js";
import { comprimir } from "../src/portable.js";
import { crearAlmacenMemoria } from "../src/almacen-memoria.js";
import { crearDriverWasm } from "../src/driver-wasm.js";

const enc = new TextEncoder();

async function deflateRaw(bytes) {
    const f = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(f).arrayBuffer());
}

/** Zip mínimo (lo justo para el lector: cabeceras locales + directorio central). */
async function crearZip(entradas, { comprimido = false } = {}) {
    const locales = [];
    const centrales = [];
    let offset = 0;
    for (const [nombre, contenido] of Object.entries(entradas)) {
        const nombreB = enc.encode(nombre);
        const datos = typeof contenido === "string" ? enc.encode(contenido) : contenido;
        const cuerpo = comprimido ? await deflateRaw(datos) : datos;
        const local = new Uint8Array(30 + nombreB.length + cuerpo.length);
        const dv = new DataView(local.buffer);
        dv.setUint32(0, 0x04034b50, true);
        dv.setUint16(4, 20, true);
        dv.setUint16(8, comprimido ? 8 : 0, true);
        dv.setUint32(18, cuerpo.length, true);
        dv.setUint32(22, datos.length, true);
        dv.setUint16(26, nombreB.length, true);
        local.set(nombreB, 30);
        local.set(cuerpo, 30 + nombreB.length);
        locales.push(local);

        const central = new Uint8Array(46 + nombreB.length);
        const dc = new DataView(central.buffer);
        dc.setUint32(0, 0x02014b50, true);
        dc.setUint16(4, 20, true);
        dc.setUint16(6, 20, true);
        dc.setUint16(10, comprimido ? 8 : 0, true);
        dc.setUint32(20, cuerpo.length, true);
        dc.setUint32(24, datos.length, true);
        dc.setUint16(28, nombreB.length, true);
        dc.setUint32(42, offset, true);
        central.set(nombreB, 46);
        centrales.push(central);
        offset += local.length;
    }
    const tamCentral = centrales.reduce((n, c) => n + c.length, 0);
    const total = new Uint8Array(offset + tamCentral + 22);
    let p = 0;
    for (const parte of [...locales, ...centrales]) {
        total.set(parte, p);
        p += parte.length;
    }
    const fin = new DataView(total.buffer, p);
    fin.setUint32(0, 0x06054b50, true);
    fin.setUint16(8, centrales.length, true);
    fin.setUint16(10, centrales.length, true);
    fin.setUint32(12, tamCentral, true);
    fin.setUint32(16, offset, true);
    return total;
}

const TEMA = JSON.stringify([
    { tema: 1, pregunta: "¿Uno?", respuestas: ["A", "B"], respuesta_correcta: "a", explicacion: "" },
    { tema: 1, pregunta: "¿Dos?", respuestas: ["A", "B"], respuesta_correcta: "b", explicacion: "" },
]);

const BANCO = {
    "bloque_1/tema_1.json": TEMA,
    "bloque_1/info.json": JSON.stringify({ nombre: "Bloque 1" }),
};

describe("leerZip y banco JSON comprimido (F4.4)", () => {
    test("lee entradas sin comprimir y deflate, y quita la carpeta raíz del banco", async () => {
        for (const comprimido of [false, true]) {
            const zip = await crearZip(BANCO, { comprimido });
            const archivos = await leerZip(zip);
            expect([...archivos.keys()].sort()).toEqual(["bloque_1/info.json", "bloque_1/tema_1.json"]);

            const fuente = await fuenteDeZip(zip);
            expect(await fuente.listar("")).toEqual(["bloque_1"]);

            const anidado = await crearZip(
                Object.fromEntries(Object.entries(BANCO).map(([r, t]) => [`mi-banco/${r}`, t])),
            );
            const fuenteAnidada = await fuenteDeZip(anidado);
            expect(await fuenteAnidada.listar("")).toEqual(["bloque_1"]); // raíz única quitada
        }
    });

    test("detectarArchivo reconoce el zip de banco y rechaza un zip sin JSON", async () => {
        const r = await detectarArchivo(await crearZip(BANCO));
        expect(r.tipo).toBe("zip");
        await expect(detectarArchivo(await crearZip({ "notas.txt": "hola" }))).rejects.toThrow(/no contiene un banco/);
        await expect(detectarArchivo(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toThrow(/zip/);
    });

    test("zip64 y datos truncados se rechazan con error claro", async () => {
        const zip = await crearZip(BANCO);
        const eocd = zip.length - 22;
        const central = new DataView(zip.buffer).getUint32(eocd + 16, true);

        const zip64 = zip.slice();
        new DataView(zip64.buffer).setUint32(eocd + 16, 0xffffffff, true);
        await expect(leerZip(zip64)).rejects.toThrow(/zip64/);

        const truncado = zip.slice();
        new DataView(truncado.buffer).setUint32(central + 20, 0x7fffffff, true); // tamaño comprimido falso
        await expect(leerZip(truncado)).rejects.toThrow(/truncados/);
    });

    test("el gestor previsualiza e importa el zip de un banco", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-zip-"));
        const gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
        try {
            const zip = await crearZip(BANCO);
            const pre = await gestor.inspeccionar(zip);
            expect(pre).toMatchObject({ tipo: "zip", preguntas: 2, errores: [], duplicado: null });
            const b = await gestor.importarBytes(zip, { nombre: "Comprimido" });
            expect(b).toMatchObject({ nombre: "Comprimido", preguntas: 2 });
            /* Importar otra vez como nuevo: «Comprimido (2)» (F3.5). */
            expect((await gestor.importarBytes(zip, { nombre: "Comprimido" })).nombre).toBe("Comprimido (2)");
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("el límite duro de tamaño también se aplica en el núcleo local (F4.6)", async () => {
        const gestor = new DatabaseManager({
            almacen: crearAlmacenMemoria(),
            driver: crearDriverWasm({ rutaWasm: "node_modules/sql.js/dist/sql-wasm.wasm" }),
            rutaCatalogo: ":memory:",
        });
        try {
            await expect(gestor.importarBytes(new Uint8Array(64_000_001))).rejects.toThrow(/demasiado grande/);
        } finally {
            await gestor.close();
        }
    });

    test("los .opios con progreso siguen detectándose como opios (regresión F3.4)", async () => {
        const bytes = await comprimir(new TextEncoder().encode("no importa"));
        expect(bytes[0]).toBe(0x1f); // sigue siendo gzip
    });
});
