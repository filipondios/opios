import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { serializarTema } from "./serializar.js";

/* Los serializadores son puros (src/serializar.js) para que la API no arrastre Node al WebView. */
export { serializarJson, serializarTema } from "./serializar.js";

/**
 * Vuelca la base de datos con la estructura `bloque_X/info.json` + `bloque_X/tema_N.json`.
 * Así se puede volver a sembrar una base limpia conservando bloques, títulos y numeración.
 */
export async function exportarPorBloques(repo, dir) {
    const temario = repo.temario();
    const porTema = new Map();
    for (const p of repo.todas()) {
        const lista = porTema.get(p.tema) ?? [];
        lista.push(p);
        porTema.set(p.tema, lista);
    }

    let bloques = 0,
        archivos = 0,
        preguntas = 0,
        omitidas = 0;
    for (const b of temario) {
        if (b.id == null) {
            omitidas += b.temas.reduce((s, t) => s + t.preguntas, 0);
            continue;
        }
        const numeroBloque = b.numero ?? b.id;
        const ruta = join(dir, `bloque_${numeroBloque}`);
        await mkdir(ruta, { recursive: true });

        /* Un tema sin título no entra en info.json: al reimportar se crea desde tema_N.json. */
        const info = {
            nombre: b.nombre,
            temas: b.temas.filter((t) => t.nombre).map((t) => ({ numero: t.numero ?? t.id, titulo: t.nombre })),
        };
        await Bun.write(join(ruta, "info.json"), JSON.stringify(info, null, 4) + "\n");
        archivos++;

        for (const t of b.temas) {
            const lista = porTema.get(t.id) ?? [];
            await Bun.write(join(ruta, `tema_${t.numero ?? t.id}.json`), serializarTema(lista));
            archivos++;
            preguntas += lista.length;
        }
        bloques++;
    }
    return { bloques, archivos, preguntas, omitidas };
}
