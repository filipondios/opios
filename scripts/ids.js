/* bun run ids [directorio]
   Añade `id_externo` a las preguntas que aún no lo tengan. El id es estable y se comparte entre
   el JSON del tema y su copia en generated/ (misma clave normalizada). Después se puede usar
   `bun run seed --actualizar` para actualizar preguntas editadas sin duplicarlas. */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DIR_PREGUNTAS } from "../src/config.js";
import { claveDe } from "../src/validar.js";

const RE_BLOQUE = /^bloque_(\d+)$/;
const RE_TEMA = /^tema_(\d+)\.json$/i;

const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? DIR_PREGUNTAS;

async function leer(archivo) {
    const datos = await Bun.file(archivo).json();
    const preguntas = Array.isArray(datos) ? datos : datos?.preguntas;
    if (!Array.isArray(preguntas)) throw new Error(`${archivo}: no contiene una lista de preguntas`);
    return { datos, preguntas, envuelto: !Array.isArray(datos) };
}

async function archivosDe(base) {
    const nombres = await readdir(base);
    const bloques = nombres.filter((n) => RE_BLOQUE.test(n)).sort();
    const salida = [];

    if (bloques.length) {
        for (const bloque of bloques) {
            const ruta = join(base, bloque);
            const dentro = await readdir(ruta);
            for (const n of dentro.filter((x) => RE_TEMA.test(x)).sort()) salida.push(join(ruta, n));
            if (dentro.includes("generated")) {
                for (const n of (await readdir(join(ruta, "generated"))).filter((x) => x.endsWith(".json")).sort())
                    salida.push(join(ruta, "generated", n));
            }
        }
        return salida;
    }

    return nombres
        .filter((x) => x.endsWith(".json") && x !== "info.json")
        .sort()
        .map((n) => join(base, n));
}

const archivos = await archivosDe(dir);
if (!archivos.length) {
    console.error(`No hay archivos de preguntas en ${dir}.`);
    process.exit(1);
}

const contenidos = new Map();
const porClave = new Map();
let existentes = 0;

/* Primera pasada: reutiliza los id_externo que ya estén en los archivos. */
for (const archivo of archivos) {
    const contenido = await leer(archivo);
    contenidos.set(archivo, contenido);
    for (const p of contenido.preguntas) {
        if (p.id_externo == null || String(p.id_externo).trim() === "") continue;
        existentes++;
        const clave = claveDe(p.pregunta);
        if (!porClave.has(clave)) porClave.set(clave, String(p.id_externo).trim());
    }
}

/* Segunda pasada: asigna un id nuevo a cada pregunta sin id (mismo id si comparte enunciado). */
let asignados = 0;
const modificados = [];
for (const [archivo, contenido] of contenidos) {
    let tocado = false;
    for (const p of contenido.preguntas) {
        if (p.id_externo != null && String(p.id_externo).trim() !== "") continue;
        const clave = claveDe(p.pregunta);
        let id = porClave.get(clave);
        if (!id) {
            id =
                globalThis.crypto?.randomUUID?.() ??
                `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            porClave.set(clave, id);
        }
        p.id_externo = id;
        asignados++;
        tocado = true;
    }
    if (tocado) {
        const datos = contenido.envuelto ? { ...contenido.datos, preguntas: contenido.preguntas } : contenido.preguntas;
        await Bun.write(archivo, JSON.stringify(datos, null, 4) + "\n");
        modificados.push(archivo);
    }
}

console.log(
    `${archivos.length} archivo(s): ${existentes} id(s) ya existentes, ${asignados} asignados en ${modificados.length} archivo(s).`,
);
if (modificados.length) console.log("Ahora puedes usar: bun run seed --actualizar");
