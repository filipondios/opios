/* Validación de un banco de preguntas sin tocar la base de datos real (Fase 8.9).
   Importa en `repo` (normalmente una BD `:memory:`) y añade comprobaciones del directorio. */
import { importarDirectorio } from "./seed.js";
import { analizarPreguntas, MINIMO_SESGO } from "./calidad.js";
import { validarInfoBloque } from "./validar.js";
import { RE_TEMA, recorrerBanco } from "./estructura-banco.js";

/** Preguntas de un archivo del banco: array u objeto `{ preguntas }`; [] si no se puede leer. */
async function leerLista(archivo) {
    try {
        const datos = await Bun.file(archivo).json();
        return Array.isArray(datos) ? datos : Array.isArray(datos?.preguntas) ? datos.preguntas : [];
    } catch {
        return [];
    }
}

/**
 * Valida un banco completo. La importación de ensayo cubre el formato de cada pregunta, el
 * `info.json` y los duplicados; después se revisan el directorio (tema declarado sin archivo)
 * y el sesgo de longitud (tarea 6.1). El recorrido lo hace `src/estructura-banco.js`, así que
 * lo ignorado aquí es exactamente lo que ignora la importación. Devuelve `{ archivos, nuevas,
 * duplicadas, actualizadas, errores, avisos }`, con los errores que invalidan el banco y los
 * avisos que solo advierten.
 */
export async function validarBanco(repo, dir, { umbralSesgo = 30, minimoMuestra = MINIMO_SESGO } = {}) {
    const r = await importarDirectorio(repo, dir);
    const errores = [...r.errores];
    const avisos = [...(r.avisos ?? [])];
    if (r.duplicadas > 0)
        avisos.push(
            `${r.duplicadas} pregunta(s) duplicadas (mismo enunciado normalizado); solo se importa la primera.`,
        );

    const banco = await recorrerBanco(dir);
    if (!banco)
        return {
            archivos: 0,
            nuevas: 0,
            duplicadas: 0,
            actualizadas: 0,
            errores: [`No existe el directorio ${dir}`],
            avisos: [],
        };

    for (const bloque of banco.bloques) {
        const { nombre: carpeta, info: archivoInfo, temas } = bloque;
        let info = null;
        if (archivoInfo) {
            try {
                info = validarInfoBloque(await Bun.file(archivoInfo.ruta).json());
            } catch {
                info = null;
            }
        }

        if (info) {
            for (const t of info.temas) {
                if (!temas.some((x) => Number(RE_TEMA.exec(x.nombre)[1]) === t.numero))
                    avisos.push(
                        `${carpeta}/info.json: el tema ${t.numero} no tiene archivo tema_${t.numero}.json (quedará vacío).`,
                    );
            }
        }

        for (const tema of temas) {
            const a = analizarPreguntas(await leerLista(tema.ruta));
            /* Con pocas muestras el porcentaje es ruido: 2 aciertos entre 6 preguntas ya superan el 30 %. */
            if (a.n >= minimoMuestra && (a.unicaLarga / a.n) * 100 > umbralSesgo)
                avisos.push(
                    `${carpeta}/${tema.nombre}: en el ${Math.round((a.unicaLarga / a.n) * 100)} % de las preguntas la opción correcta es la única más larga (umbral ${umbralSesgo} %, mínimo ${minimoMuestra} preguntas).`,
                );
        }
    }

    return {
        archivos: r.archivos,
        nuevas: r.nuevas,
        duplicadas: r.duplicadas,
        actualizadas: r.actualizadas ?? 0,
        errores,
        avisos,
    };
}
