/* Validación de un banco de preguntas sin tocar la base de datos real (Fase 8.9).
   Importa en `repo` (normalmente una BD `:memory:`) y añade comprobaciones del directorio. */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { importarDirectorio } from "./seed.js";
import { analizarPreguntas } from "./calidad.js";
import { validarInfoBloque } from "./validar.js";

const RE_BLOQUE = /^bloque_(\d+)$/;
const RE_TEMA = /^tema_(\d+)\.json$/i;
const numero = (re, nombre) => Number(re.exec(nombre)[1]);

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
 * y el sesgo de longitud (tarea 6.1). Devuelve `{ archivos, nuevas, duplicadas, actualizadas,
 * errores, avisos }`, con los errores que invalidan el banco y los avisos que solo advierten.
 */
export async function validarBanco(repo, dir, { umbralSesgo = 30 } = {}) {
  const r = await importarDirectorio(repo, dir);
  const errores = [...r.errores];
  const avisos = [...(r.avisos ?? [])];
  if (r.duplicadas > 0)
    avisos.push(`${r.duplicadas} pregunta(s) duplicadas (mismo enunciado normalizado); solo se importa la primera.`);

  let nombres;
  try {
    nombres = await readdir(dir);
  } catch {
    return { archivos: 0, nuevas: 0, duplicadas: 0, actualizadas: 0, errores: [`No existe el directorio ${dir}`], avisos: [] };
  }

  const bloques = nombres.filter((n) => RE_BLOQUE.test(n))
    .sort((a, b) => numero(RE_BLOQUE, a) - numero(RE_BLOQUE, b));

  for (const carpeta of bloques) {
    const ruta = join(dir, carpeta);
    let info = null;
    const archivoInfo = join(ruta, "info.json");
    if (await Bun.file(archivoInfo).exists()) {
      try { info = validarInfoBloque(await Bun.file(archivoInfo).json()); } catch { info = null; }
    }

    let dentro;
    try { dentro = await readdir(ruta); } catch { continue; }
    const temas = dentro.filter((n) => RE_TEMA.test(n))
      .sort((a, b) => numero(RE_TEMA, a) - numero(RE_TEMA, b));

    if (info) {
      for (const t of info.temas) {
        if (!temas.some((n) => numero(RE_TEMA, n) === t.numero))
          avisos.push(`${carpeta}/info.json: el tema ${t.numero} no tiene archivo tema_${t.numero}.json (quedará vacío).`);
      }
    }

    for (const nombre of temas) {
      const a = analizarPreguntas(await leerLista(join(ruta, nombre)));
      if (a.n >= 5 && (a.unicaLarga / a.n) * 100 > umbralSesgo)
        avisos.push(`${carpeta}/${nombre}: en el ${Math.round((a.unicaLarga / a.n) * 100)} % de las preguntas la opción correcta es la única más larga (umbral ${umbralSesgo} %).`);
    }
  }

  return { archivos: r.archivos, nuevas: r.nuevas, duplicadas: r.duplicadas, actualizadas: r.actualizadas ?? 0, errores, avisos };
}
