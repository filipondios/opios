/* bun run ids [directorio] [--incluir <carpeta>]
   Añade `id_externo` a las preguntas que aún no lo tengan. El id es estable y se comparte entre
   los archivos que contengan el mismo enunciado (misma clave normalizada), así que una copia del
   tema en otra carpeta revisada recibe el mismo id. Por defecto solo se tocan los archivos que la
   app importa; con `--incluir generated` (repetible) se añaden otras carpetas del bloque (2.5).
   Después se puede usar `bun run seed --actualizar` para actualizar preguntas editadas sin duplicarlas. */
import { join } from "node:path";
import { DIR_PREGUNTAS } from "../src/config.js";
import { claveDe } from "../src/validar.js";
import { archivosDeBanco } from "../src/estructura-banco.js";
import { ejecutarCli } from "../src/cli.js";

const args = process.argv.slice(2);
const incluye = [];
let dir = null;
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--incluir") incluye.push(args[++i]);
    else if (a.startsWith("--incluir=")) incluye.push(a.slice("--incluir=".length));
    else if (!a.startsWith("--")) dir = a;
}
dir = dir ?? DIR_PREGUNTAS;

async function leer(archivo) {
    const datos = await Bun.file(archivo).json();
    const preguntas = Array.isArray(datos) ? datos : datos?.preguntas;
    if (!Array.isArray(preguntas)) throw new Error(`${archivo}: no contiene una lista de preguntas`);
    return { datos, preguntas, envuelto: !Array.isArray(datos) };
}

await ejecutarCli(async () => {
    const { banco, archivos } = await archivosDeBanco(dir, { incluye });
    if (!banco) {
        console.error(`No existe el directorio ${dir}.`);
        process.exitCode = 1;
        return;
    }
    if (!archivos.length) {
        console.error(`No hay archivos de preguntas en ${dir}.`);
        process.exitCode = 1;
        return;
    }

    const contenidos = new Map();
    const porClave = new Map();
    let existentes = 0;

    /* Primera pasada: reutiliza los id_externo que ya estén en los archivos. */
    for (const f of archivos) {
        const contenido = await leer(f.ruta);
        contenidos.set(f.ruta, contenido);
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
            const datos = contenido.envuelto
                ? { ...contenido.datos, preguntas: contenido.preguntas }
                : contenido.preguntas;
            await Bun.write(archivo, JSON.stringify(datos, null, 4) + "\n");
            modificados.push(archivo.replace(join(dir, "") + "/", ""));
        }
    }

    console.log(
        `${archivos.length} archivo(s): ${existentes} id(s) ya existentes, ${asignados} asignados en ${modificados.length} archivo(s).`,
    );
    if (modificados.length) console.log("Ahora puedes usar: bun run seed --actualizar");
});
