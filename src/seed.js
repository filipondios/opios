import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { desdeJsonAntiguo, validarInfoBloque, opcionDependiente } from "./validar.js";

const RE_BLOQUE = /^bloque_(\d+)$/;
const RE_TEMA = /^tema_(\d+)\.json$/i;
const RE_JSON = /\.json$/i;

const numeroDe = (re, nombre) => Number(re.exec(nombre)[1]);

/** Lee un archivo que debe contener una lista de preguntas (o { preguntas: [...] }). */
async function leerLista(archivo) {
  let datos;
  try { datos = await Bun.file(archivo).json(); }
  catch (e) { throw new Error(`JSON no válido (${e.message})`); }
  if (!Array.isArray(datos)) datos = datos && Array.isArray(datos.preguntas) ? datos.preguntas : null;
  if (!datos) throw new Error("debe contener una lista de preguntas");
  return datos;
}

/** Importa los JSON sueltos del formato antiguo. Devuelve las preguntas válidas y los errores. */
async function leerPlanos(dir, nombres, { avisar = false } = {}) {
  const validas = [], errores = [], avisos = [];
  let archivos = 0;
  const sueltos = nombres.filter((n) => RE_JSON.test(n)).sort();
  if (sueltos.length && avisar)
    avisos.push("Hay JSON sueltos en la raíz de preguntas/: usa preguntas/bloque_X/tema_N.json (el formato antiguo sigue funcionando por ahora).");
  for (const nombre of sueltos) {
    archivos++;
    let datos;
    try { datos = await leerLista(join(dir, nombre)); }
    catch (e) { errores.push(`${nombre}: ${e.message}`); continue; }
    datos.forEach((p, i) => {
      try {
        const v = desdeJsonAntiguo(p);
        const dep = opcionDependiente(v.respuestas);
        if (dep) avisos.push(`${nombre} #${i + 1}: la opción «${dep}» parece depender del orden de las opciones.`);
        validas.push(v);
      }
      catch (e) { errores.push(`${nombre} #${i + 1}: ${e.message}`); }
    });
  }
  return { archivos, validas, errores, avisos };
}

/** Convierte una pregunta de un `tema_N.json` de bloque al formato interno, comprobando metadatos. */
function desdeJsonDeBloque(p, { bloqueNumero, bloqueNombre, temaNumero, archivo, indice }) {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("no es un objeto");
  if (p.bloque != null && String(p.bloque).trim() !== "") {
    const declarado = String(p.bloque).trim();
    const coincide = /^\d+$/.test(declarado)
      ? Number(declarado) === bloqueNumero
      : declarado.toLowerCase() === bloqueNombre.toLowerCase();
    if (!coincide) throw new Error(`el bloque declarado («${declarado}») no coincide con ${archivo}`);
  }
  const temaDeclarado = p.tema_numero ?? p.tema;
  if (temaDeclarado != null && String(temaDeclarado).trim() !== "" && Number(temaDeclarado) !== temaNumero)
    throw new Error(`el tema declarado (${temaDeclarado}) no coincide con ${archivo}`);
  return desdeJsonAntiguo({
    ...p,
    tema: temaNumero,
    bloque: bloqueNombre,
    bloque_numero: bloqueNumero,
    tema_numero: temaNumero,
  });
}

/**
 * Importa una estructura `preguntas/bloque_X/info.json` + `preguntas/bloque_X/tema_N.json`.
 * `generated/` y `examenes/` no se recorren. Los JSON sueltos de la raíz se siguen aceptando.
 */
async function importarPorBloques(repo, dir, nombres, opciones) {
  const carpetas = nombres.filter((n) => RE_BLOQUE.test(n)).sort((a, b) => numeroDe(RE_BLOQUE, a) - numeroDe(RE_BLOQUE, b));
  const validas = [], errores = [], avisos = [], gestionados = [];
  let archivos = 0;

  for (const carpeta of carpetas) {
    const bloqueNumero = numeroDe(RE_BLOQUE, carpeta);
    const ruta = join(dir, carpeta);
    let info = null;
    const archivoInfo = join(ruta, "info.json");
    if (await Bun.file(archivoInfo).exists()) {
      try {
        const datos = await Bun.file(archivoInfo).json();
        if (datos?.numero != null && Number(datos.numero) !== bloqueNumero)
          throw new Error(`el número declarado (${datos.numero}) no coincide con la carpeta ${carpeta}`);
        info = validarInfoBloque(datos);
      } catch (e) {
        errores.push(`${carpeta}/info.json: ${e.message}`);
      }
    }

    const bloqueNombre = info?.nombre ?? `Bloque ${bloqueNumero}`;
    if (info) {
      try {
        repo.sincronizarInfoBloque(bloqueNumero, info);
        gestionados.push(bloqueNumero);
      } catch (e) {
        errores.push(`${carpeta}/info.json: ${e.message}`);
      }
    } else {
      try { repo.asegurarBloque({ numero: bloqueNumero, nombre: bloqueNombre }); }
      catch (e) { errores.push(`${carpeta}: ${e.message}`); }
    }

    let temas = [];
    try { temas = (await readdir(ruta)).filter((n) => RE_TEMA.test(n)).sort((a, b) => numeroDe(RE_TEMA, a) - numeroDe(RE_TEMA, b)); }
    catch (e) { errores.push(`${carpeta}: ${e.message}`); continue; }

    if (info) {
      const declarados = new Set(info.temas.map((t) => t.numero));
      for (const nombre of temas) {
        const n = numeroDe(RE_TEMA, nombre);
        if (!declarados.has(n)) avisos.push(`${carpeta}/${nombre}: el tema ${n} no aparece en info.json (se importa igual).`);
      }
    }

    for (const nombre of temas) {
      archivos++;
      const temaNumero = numeroDe(RE_TEMA, nombre);
      let datos;
      try { datos = await leerLista(join(ruta, nombre)); }
      catch (e) { errores.push(`${carpeta}/${nombre}: ${e.message}`); continue; }
      datos.forEach((p, i) => {
        try {
          const v = desdeJsonDeBloque(p, {
            bloqueNumero, bloqueNombre, temaNumero,
            archivo: `${carpeta}/${nombre} #${i + 1}`,
            indice: i,
          });
          const dep = opcionDependiente(v.respuestas);
          if (dep) avisos.push(`${carpeta}/${nombre} #${i + 1}: la opción «${dep}» parece depender del orden de las opciones.`);
          validas.push(v);
        } catch (e) { errores.push(`${carpeta}/${nombre} #${i + 1}: ${e.message}`); }
      });
    }
  }

  repo.desmarcarGestionadosExcepto(gestionados);

  /* Transición: los JSON sueltos de la raíz siguen funcionando, con aviso. */
  const planos = await leerPlanos(dir, nombres, { avisar: true });
  archivos += planos.archivos;
  validas.push(...planos.validas);
  errores.push(...planos.errores);
  avisos.push(...planos.avisos);

  const { nuevas, duplicadas, actualizadas } = repo.importar(validas, opciones);
  return { archivos, nuevas, duplicadas, actualizadas, errores, avisos };
}

/** Importa un directorio: detecta `bloque_X/` o cae al formato antiguo de JSON sueltos. */
export async function importarDirectorio(repo, dir, opciones = {}) {
  let nombres = [];
  try { nombres = await readdir(dir); }
  catch { return { archivos: 0, nuevas: 0, duplicadas: 0, actualizadas: 0, errores: [`No existe el directorio ${dir}`], avisos: [] }; }

  if (nombres.some((n) => RE_BLOQUE.test(n))) return importarPorBloques(repo, dir, nombres, opciones);

  const planos = await leerPlanos(dir, nombres);
  const { nuevas, duplicadas, actualizadas } = repo.importar(planos.validas, opciones);
  return { archivos: planos.archivos, nuevas, duplicadas, actualizadas, errores: planos.errores, avisos: planos.avisos };
}
