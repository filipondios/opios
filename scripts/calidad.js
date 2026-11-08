/* bun run calidad [directorio] [--umbral 30] [--lista] [--fallar]
   Mide el sesgo de la opción más larga y la posición de la correcta. Incluye generated/.
   `--fallar` sale con código 1 si algún archivo supera el umbral (para usarlo antes de importar). */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DIR_PREGUNTAS } from "../src/config.js";
import { analizarPreguntas } from "../src/calidad.js";

const RE_BLOQUE = /^bloque_(\d+)$/;
const RE_TEMA = /^tema_(\d+)\.json$/i;
const numero = (re, nombre) => Number(re.exec(nombre)[1]);
const pct = (parte, total) => (total ? (parte / total) * 100 : 0);
const fmtPct = (parte, total) => (total ? pct(parte, total).toFixed(1) + " %" : "—");

const args = process.argv.slice(2);
let dir = DIR_PREGUNTAS, umbral = 30, lista = false, fallar = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--umbral") umbral = Number(args[++i]);
  else if (a.startsWith("--umbral=")) umbral = Number(a.slice("--umbral=".length));
  else if (a === "--lista") lista = true;
  else if (a === "--fallar") fallar = true;
  else if (!a.startsWith("--")) dir = a;
}

async function leer(archivo) {
  const datos = await Bun.file(archivo).json();
  return Array.isArray(datos) ? datos : datos?.preguntas ?? [];
}

async function archivosDe(base) {
  const nombres = await readdir(base);
  const salida = [];
  const bloques = nombres.filter((n) => RE_BLOQUE.test(n))
    .sort((a, b) => numero(RE_BLOQUE, a) - numero(RE_BLOQUE, b));

  if (bloques.length) {
    for (const bloque of bloques) {
      const ruta = join(base, bloque);
      const dentro = await readdir(ruta);
      for (const n of dentro.filter((x) => RE_TEMA.test(x))
        .sort((a, b) => numero(RE_TEMA, a) - numero(RE_TEMA, b)))
        salida.push({ archivo: join(ruta, n), etiqueta: `${bloque}/${n}`, generado: false });

      if (dentro.includes("generated")) {
        const generados = (await readdir(join(ruta, "generated")))
          .filter((x) => x.endsWith(".json")).sort();
        for (const n of generados)
          salida.push({ archivo: join(ruta, "generated", n), etiqueta: `${bloque}/generated/${n}`, generado: true });
      }
    }
    return salida;
  }

  for (const n of nombres.filter((x) => x.endsWith(".json") && x !== "info.json").sort())
    salida.push({ archivo: join(base, n), etiqueta: n, generado: false });
  return salida;
}

const archivos = await archivosDe(dir);
if (!archivos.length) {
  console.error(`No hay archivos de preguntas en ${dir}.`);
  process.exit(1);
}

const filas = [];
for (const f of archivos) {
  const preguntas = await leer(f.archivo);
  filas.push({ ...f, preguntas, ...analizarPreguntas(preguntas) });
}

const ancho = Math.max(20, ...filas.map((f) => f.etiqueta.length));
console.log(`Sesgo de la opción más larga (${dir})\n`);
console.log(
  "archivo".padEnd(ancho) + "  n".padStart(5) + "  única".padStart(8) + "  empate".padStart(8) +
  "  dif".padStart(7) + "  ratio".padStart(7) + "  posiciones A-D",
);
console.log("-".repeat(ancho + 55));
for (const f of filas) {
  const pos = f.posiciones.slice(0, 4).map((n) => String(n).padStart(4)).join(" ");
  console.log(
    (f.etiqueta + (f.generado ? " *" : "")).padEnd(ancho) + String(f.n).padStart(5) +
    fmtPct(f.unicaLarga, f.n).padStart(8) + fmtPct(f.masLargaEmpate, f.n).padStart(8) +
    f.diferenciaMedia.toFixed(1).padStart(7) + f.ratioMedio.toFixed(2).padStart(7) + "  " + pos,
  );
}

function resumen(etiqueta, lista) {
  const n = lista.reduce((s, f) => s + f.n, 0);
  const unica = lista.reduce((s, f) => s + f.unicaLarga, 0);
  const empate = lista.reduce((s, f) => s + f.masLargaEmpate, 0);
  console.log(`\n${etiqueta}: ${n} preguntas · única más larga ${fmtPct(unica, n)} · correcta entre las más largas ${fmtPct(empate, n)}`);
}
resumen("Importables", filas.filter((f) => !f.generado));
const generadas = filas.filter((f) => f.generado);
if (generadas.length) resumen("Generadas (no se importan)", generadas);
console.log("Nota: con 4 opciones al azar, la correcta sería la única más larga ~25 % de las veces.");

if (lista) {
  for (const f of filas) {
    if (!f.sesgadas.length) continue;
    console.log(`\n${f.etiqueta} (${f.sesgadas.length})`);
    for (const s of f.sesgadas) {
      console.log(`  #${s.indice + 1} [correcta ${"abcdefgh"[s.correcta]}] ${s.pregunta}`);
      s.opciones.forEach((o, i) => console.log(`     ${i === s.correcta ? "*" : " "}${"abcdefgh"[i]}) ${o.length} · ${o}`));
    }
  }
}

const superan = filas.filter((f) => f.n >= 5 && pct(f.unicaLarga, f.n) > umbral);
if (superan.length) {
  console.warn(`\n${superan.length} archivo(s) superan el umbral del ${umbral} %: ${superan.map((f) => f.etiqueta).join(", ")}`);
} else {
  console.log(`\nNingún archivo supera el umbral del ${umbral} %.`);
}
if (fallar && superan.length) process.exit(1);
