import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const LETRAS = "abcdefgh";

/** Líneas JSON de una pregunta con el formato de los `tema_N.json` del banco (sangrado de 4 espacios). */
function lineasPregunta(q, { conTemario }) {
    const lineas = ["    {"];
    if (conTemario) {
        lineas.push('        "tema": ' + q.tema + ",");
        if (q.bloque != null) {
            lineas.push('        "bloque": ' + JSON.stringify(q.bloque_nombre ?? "") + ",");
            if (q.bloque_numero != null) lineas.push('        "bloque_numero": ' + q.bloque_numero + ",");
            lineas.push('        "tema_numero": ' + (q.tema_numero ?? q.tema) + ",");
        }
    }
    lineas.push('        "pregunta": ' + JSON.stringify(q.pregunta) + ",");
    if (q.id_externo) lineas.push('        "id_externo": ' + JSON.stringify(q.id_externo) + ",");
    lineas.push(
        '        "respuestas": [' + q.respuestas.map((r) => JSON.stringify(r)).join(", ") + "],",
        '        "respuesta_correcta": "' + LETRAS[q.correcta] + '",',
        '        "explicacion": ' + JSON.stringify(q.explicacion),
        "    }",
    );
    return lineas.join("\n");
}

function serializar(preguntas, opciones) {
    return "[\n" + preguntas.map((q) => lineasPregunta(q, opciones)).join(",\n") + "\n]\n";
}

/** Serializa preguntas con el formato antiguo (incluye tema/bloque para no perder el temario al reimportar). */
export function serializarJson(preguntas) {
    return serializar(preguntas, { conTemario: true });
}

/** Serializa las preguntas de un `tema_N.json` dentro de `bloque_X/`: los metadatos salen de la carpeta y de info.json. */
export function serializarTema(preguntas) {
    return serializar(preguntas, { conTemario: false });
}

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
