import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { desdeJsonAntiguo } from "./validar.js";

/** Importa a la DB todos los `*.json` de un directorio (formato antiguo de preguntas/). */
export async function importarDirectorio(repo, dir) {
  let nombres = [];
  try { nombres = (await readdir(dir)).filter((n) => /\.json$/i.test(n)).sort(); }
  catch { return { archivos: 0, nuevas: 0, duplicadas: 0, errores: [`No existe el directorio ${dir}`] }; }

  const validas = [], errores = [];
  for (const nombre of nombres) {
    let datos;
    try { datos = await Bun.file(join(dir, nombre)).json(); }
    catch (e) { errores.push(`${nombre}: JSON no válido (${e.message})`); continue; }
    if (!Array.isArray(datos)) datos = datos && Array.isArray(datos.preguntas) ? datos.preguntas : null;
    if (!datos) { errores.push(`${nombre}: debe contener una lista de preguntas`); continue; }
    datos.forEach((p, i) => {
      try { validas.push(desdeJsonAntiguo(p)); }
      catch (e) { errores.push(`${nombre} #${i + 1}: ${e.message}`); }
    });
  }
  const { nuevas, duplicadas } = repo.importar(validas);
  return { archivos: nombres.length, nuevas, duplicadas, errores };
}
