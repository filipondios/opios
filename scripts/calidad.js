/* bun run calidad [directorio] [--umbral 30] [--minimo 20] [--incluir <carpeta>] [--lista] [--fallar]
   Mide el sesgo de la opción más larga y la posición de la correcta sobre lo que el banco importa.
   Con `--incluir generated` (repetible) se analizan también otras carpetas del bloque que no se
   importan; sin esa opción la app no necesita conocer ningún nombre concreto (Fase 2.5). */
import { join } from "node:path";
import { DIR_PREGUNTAS } from "../src/config-servidor.js";
import { analizarPreguntas, MINIMO_SESGO } from "../src/calidad.js";
import { archivosDeBanco } from "../src/estructura-banco.js";

const pct = (parte, total) => (total ? (parte / total) * 100 : 0);
const fmtPct = (parte, total) => (total ? pct(parte, total).toFixed(1) + " %" : "—");

const args = process.argv.slice(2);
let dir = DIR_PREGUNTAS,
    umbral = 30,
    minimo = MINIMO_SESGO,
    lista = false,
    fallar = false;
const incluye = [];
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--umbral") umbral = Number(args[++i]);
    else if (a.startsWith("--umbral=")) umbral = Number(a.slice("--umbral=".length));
    else if (a === "--minimo") minimo = Number(args[++i]);
    else if (a.startsWith("--minimo=")) minimo = Number(a.slice("--minimo=".length));
    else if (a === "--incluir") incluye.push(args[++i]);
    else if (a.startsWith("--incluir=")) incluye.push(a.slice("--incluir=".length));
    else if (a === "--lista") lista = true;
    else if (a === "--fallar") fallar = true;
    else if (!a.startsWith("--")) dir = a;
}

async function leer(archivo) {
    try {
        const datos = await Bun.file(archivo).json();
        return Array.isArray(datos) ? datos : (datos?.preguntas ?? []);
    } catch {
        return [];
    }
}

const { banco, archivos } = await archivosDeBanco(dir, { incluye });
if (!banco) {
    console.error(`No existe el directorio ${dir}.`);
    process.exit(1);
}
if (!archivos.length) {
    console.error(`No hay archivos de preguntas en ${dir}.`);
    process.exit(1);
}

const filas = [];
for (const f of archivos) {
    const preguntas = await leer(f.ruta);
    const etiqueta = f.bloque ? `${f.bloque}/${f.ruta.slice(join(dir, f.bloque).length + 1)}` : f.ruta;
    filas.push({ etiqueta, generado: f.generado, ...analizarPreguntas(preguntas) });
}

const ancho = Math.max(20, ...filas.map((f) => f.etiqueta.length));
console.log(`Sesgo de la opción más larga (${dir})${incluye.length ? ` · incluidas: ${incluye.join(", ")}` : ""}\n`);
console.log(
    "archivo".padEnd(ancho) +
        "  n".padStart(5) +
        "  única".padStart(8) +
        "  empate".padStart(8) +
        "  dif".padStart(7) +
        "  ratio".padStart(7) +
        "  posiciones A-D",
);
console.log("-".repeat(ancho + 55));
for (const f of filas) {
    const pos = f.posiciones
        .slice(0, 4)
        .map((n) => String(n).padStart(4))
        .join(" ");
    console.log(
        (f.etiqueta + (f.generado ? " *" : "")).padEnd(ancho) +
            String(f.n).padStart(5) +
            fmtPct(f.unicaLarga, f.n).padStart(8) +
            fmtPct(f.masLargaEmpate, f.n).padStart(8) +
            f.diferenciaMedia.toFixed(1).padStart(7) +
            f.ratioMedio.toFixed(2).padStart(7) +
            "  " +
            pos,
    );
}

function resumen(etiqueta, lista) {
    const n = lista.reduce((s, f) => s + f.n, 0);
    const unica = lista.reduce((s, f) => s + f.unicaLarga, 0);
    const empate = lista.reduce((s, f) => s + f.masLargaEmpate, 0);
    console.log(
        `\n${etiqueta}: ${n} preguntas · única más larga ${fmtPct(unica, n)} · correcta entre las más largas ${fmtPct(empate, n)}`,
    );
}
resumen(
    "Importables",
    filas.filter((f) => !f.generado),
);
if (filas.some((f) => f.generado))
    resumen(
        "Incluidos aparte",
        filas.filter((f) => f.generado),
    );

/* Solo se avisa con muestras suficientes: con pocas preguntas el porcentaje es ruido (Fase 2.7). */
const sesgadas = filas.filter((f) => f.n >= minimo && pct(f.unicaLarga, f.n) > umbral);
if (sesgadas.length) {
    console.log(`\n${sesgadas.length} archivo(s) superan el ${umbral} % (con ${minimo} preguntas o más):`);
    for (const f of sesgadas) console.log(`  ${f.etiqueta}: ${fmtPct(f.unicaLarga, f.n)} (${f.n} preguntas)`);
    if (lista)
        for (const f of filas.filter((x) => x.n >= minimo && pct(x.unicaLarga, x.n) > umbral))
            for (const s of f.sesgadas)
                console.log(
                    `\n${f.etiqueta} #${s.indice + 1} · correcta ${"abcdefgh"[s.correcta]} · ${s.longitudCorrecta} caracteres\n  ${s.pregunta}\n` +
                        s.opciones
                            .map((o, k) => `  ${k === s.correcta ? ">" : " "} ${"abcdefgh"[k]}) ${o} (${o.length})`)
                            .join("\n"),
                );
}

if (fallar && sesgadas.length) process.exit(1);
