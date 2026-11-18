/* Copia completa `.opios-backup` (F5.6): escritor de zip (CRC-32, método store) y el
   contenedor zip con `manifest.json` + un `.opios` por banco. */
import { describe, expect, test } from "bun:test";

import { crearZip, leerZip } from "../src/banco-zip.js";
import { empaquetarCopia, leerCopia, FORMATO_COPIA } from "../src/copia.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

describe("crearZip (escritor, F5.6)", () => {
    test("ida y vuelta con texto, bytes y nombre no ASCII; CRC-32 correcto", async () => {
        const zip = crearZip({ "leeme.txt": "123456789", "á/ñ.bin": new Uint8Array([0, 1, 255, 128]) });
        /* CRC-32 del primer dato (cabecera local, offset 14): vector conocido de "123456789". */
        expect(u32(zip, 14)).toBe(0xcbf43926);
        const mapa = await leerZip(zip);
        expect(dec.decode(mapa.get("leeme.txt"))).toBe("123456789");
        expect([...mapa.get("á/ñ.bin")]).toEqual([0, 1, 255, 128]);
        expect([...mapa.keys()]).toEqual(["leeme.txt", "á/ñ.bin"]);
    });
});

describe("copia .opios-backup (F5.6)", () => {
    const banco = (nombre) => ({
        archivo: `${nombre}.opios`,
        manifest: { nombre, preguntas: 3, user_version: 13 },
        bytes: enc.encode(`opios:${nombre}`),
    });

    test("empaquetar y leer conserva el manifest y los bytes de cada banco", async () => {
        const { bytes, manifest } = empaquetarCopia([banco("Uno"), banco("Dos")], {
            creado: "2026-01-02T03:04:05.000Z",
        });
        expect(manifest).toMatchObject({ formato: FORMATO_COPIA, app: "opios", creado: "2026-01-02T03:04:05.000Z" });
        expect(manifest.bancos).toEqual([
            { archivo: "Uno.opios", nombre: "Uno", preguntas: 3, user_version: 13 },
            { archivo: "Dos.opios", nombre: "Dos", preguntas: 3, user_version: 13 },
        ]);
        const copia = await leerCopia(bytes);
        expect(copia.manifest.formato).toBe(FORMATO_COPIA);
        expect(copia.bancos.map((b) => b.archivo)).toEqual(["Uno.opios", "Dos.opios"]);
        expect(dec.decode(copia.bancos[0].bytes)).toBe("opios:Uno");
    });

    test("rechaza lo que no es una copia: sin manifest, formato futuro o banco ausente", async () => {
        await expect(leerCopia(crearZip({ "otro.txt": "hola" }))).rejects.toThrow(/manifest\.json/);
        await expect(leerCopia(new Uint8Array([1, 2, 3]))).rejects.toThrow(/copia de Opios/i);
        const futuro = crearZip({ "manifest.json": JSON.stringify({ formato: FORMATO_COPIA + 1, bancos: [] }) });
        await expect(leerCopia(futuro)).rejects.toThrow(/formato 2 no soportado/);
        const falta = crearZip({
            "manifest.json": JSON.stringify({ formato: FORMATO_COPIA, bancos: [{ archivo: "X.opios", nombre: "X" }] }),
        });
        await expect(leerCopia(falta)).rejects.toThrow(/no contiene el banco «X\.opios»/);
    });
});
