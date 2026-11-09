import { html } from "./html.js";
import { layout } from "./layout.js";
import { sumarDias } from "../fechas.js";
import { etiquetaTema } from "../etiquetas.js";
import { textoExamen } from "./home.js";
import { anillo, barraApilada, columnas, linea, mapaCalor } from "./graficos.js";

const fmt = (n) => Number(n ?? 0).toLocaleString("es-ES");
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) + " %" : "—");
const precision = (aciertos, fallos) => (aciertos + fallos > 0 ? pct(aciertos, aciertos + fallos) : "—");
const precisionNum = (aciertos, fallos) => (aciertos + fallos > 0 ? (100 * aciertos) / (aciertos + fallos) : null);
const fechaCorta = (fecha) => {
    const [f] = String(fecha).split(" ");
    const [a, m, d] = f.split("-");
    return `${d}/${m}/${a}`;
};
const tiempo = (segundos) => {
    const s = Math.max(0, Number(segundos) || 0);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const etiquetaDia = (fecha, hoy) => {
    if (fecha === hoy) return "Hoy";
    if (fecha === sumarDias(hoy, 1)) return "Mañana";
    return new Date(fecha + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric" });
};

/** Agrupa las filas de estadísticas por bloque, conservando el orden que devuelve SQLite. */
function porBloque(temas) {
    const grupos = [];
    const vistos = new Map();
    for (const t of temas) {
        const clave = t.bloque ?? "sin";
        if (!vistos.has(clave)) {
            const g = { nombre: t.bloque_nombre || "Sin bloque", temas: [] };
            vistos.set(clave, g);
            grupos.push(g);
        }
        vistos.get(clave).temas.push(t);
    }
    return grupos;
}

function kpiPrincipal({ valor, etiqueta, detalle = "", extra = null }) {
    return html`<div class="kpi-principal">
    <div class="kpi-principal-dato">${extra ?? html`<span class="kpi-n">${valor}</span>`}</div>
    <span class="kpi-l">${etiqueta}</span>
    ${detalle ? html`<span class="kpi-detalle">${detalle}</span>` : ""}
  </div>`;
}

function filaTema(t) {
    const vistas = t.total - t.nuevas;
    const pr = precision(t.aciertos, t.fallos);
    return html`<details class="tema-fila">
    <summary>
      <span class="tema-fila-nombre"><b>${etiquetaTema(t, { bloque: false, nombre: false })}</b>${t.tema_nombre ? html`<span>${t.tema_nombre}</span>` : ""}</span>
      <span class="tema-fila-barra">${barraApilada({ dominadas: t.dominadas, aprendiendo: t.aprendiendo, nuevas: t.nuevas, total: t.total, etiqueta: "Progreso del tema" })}</span>
      <span class="tema-fila-pct">${pr}</span>
    </summary>
    <div class="tema-fila-cifras">
      <span><b>${fmt(t.total)}</b> preguntas</span>
      <span><b>${fmt(vistas)}</b> vistas</span>
      <span><b>${fmt(t.dominadas)}</b> dominadas</span>
      <span><b>${fmt(t.aprendiendo)}</b> aprendiendo</span>
      <span><b>${fmt(t.repaso)}</b> hoy</span>
      <span><b>${fmt(t.aciertos)}</b> aciertos</span>
      <span><b>${fmt(t.fallos)}</b> fallos</span>
    </div>
  </details>`;
}

function tablaTemas(temas) {
    return porBloque(temas).map(
        (b) => html`
    <section class="stats-bloque">
      <div class="stats-bloque-head"><h3>${b.nombre}</h3><span>${b.temas.length} ${b.temas.length === 1 ? "tema" : "temas"}</span></div>
      <div class="temas-filas">${b.temas.map(filaTema)}</div>
    </section>`,
    );
}

function previsionRepasos(prevision, hoy) {
    const porFecha = new Map(prevision.map((f) => [f.vence, f.n]));
    const vencidas = prevision.filter((f) => f.vence < hoy).reduce((s, f) => s + f.n, 0);
    const datos = Array.from({ length: 7 }, (_, i) => {
        const fecha = sumarDias(hoy, i);
        return { etiqueta: etiquetaDia(fecha, hoy), valor: porFecha.get(fecha) ?? 0, hoy: i === 0 };
    });
    return html`
    ${vencidas ? html`<p class="vencidas"><b>${fmt(vencidas)}</b> vencidas de días anteriores</p>` : ""}
    ${columnas({ datos, titulo: "Previsión de repasos", descripcion: "Repasos que vencen cada uno de los próximos 7 días", id: "prevision" })}
    <p class="hint">Hoy se resalta en la primera columna. Las vencidas se cuentan aparte.</p>`;
}

function bloqueActividad(actividad, hoy, racha) {
    const datos = actividad.map((d) => ({ fecha: d.dia, valor: d.n }));
    return html`
    ${mapaCalor({ datos, hoy, semanas: 12, titulo: "Actividad de las últimas 12 semanas", descripcion: "Respuestas registradas por día", id: "actividad" })}
    <p class="hint">Cada celda es un día; cuanto más oscura, más respuestas. Racha actual: <b>${fmt(racha)}</b> ${racha === 1 ? "día" : "días"}.</p>`;
}

function precisionSemanal(semanas) {
    if (!semanas.length)
        return html`<p class="empty">Todavía no hay respuestas registradas. Haz un test para empezar.</p>`;
    const puntos = semanas.map((s) => ({
        etiqueta: fechaCorta(s.desde),
        valor: s.aciertos + s.fallos ? Math.round((100 * s.aciertos) / (s.aciertos + s.fallos)) : 0,
    }));
    const ultima = puntos[puntos.length - 1];
    const anterior = puntos.length > 1 ? puntos[puntos.length - 2] : null;
    const variacion = anterior ? ultima.valor - anterior.valor : null;
    return html`
    ${linea({ puntos, maximo: 100, titulo: "Precisión por semana", descripcion: "Porcentaje de aciertos en las últimas semanas", id: "semanas" })}
    <p class="hint">${anterior ? html`${variacion >= 0 ? "+" : ""}${variacion} puntos respecto a la semana anterior.` : "Primera semana con respuestas."}</p>`;
}

function evolucionSimulacros(simulacros) {
    if (!simulacros.length)
        return html`<p class="empty">Todavía no has hecho ningún simulacro. <a href="/simulacro">Empieza uno</a>.</p>`;
    const serie = [...simulacros].reverse().map((s) => ({
        fecha: s.fecha,
        nota: (s.aciertos / s.total) * 10,
        puntos: Number(s.puntos),
    }));
    const media = serie.reduce((s, x) => s + x.nota, 0) / serie.length;
    const mejor = Math.max(...serie.map((x) => x.nota));
    return html`
    <div class="simulacro-resumen"><span><b>${media.toFixed(1)}</b> media</span><span><b>${mejor.toFixed(1)}</b> mejor</span></div>
    ${linea({ puntos: serie.map((x) => ({ etiqueta: fechaCorta(x.fecha), valor: x.nota })), maximo: 10, titulo: "Notas de los simulacros", descripcion: "Nota sobre 10 de cada simulacro", id: "simulacros" })}
    <p class="hint">Nota sobre 10; la penalización se aplica en los puntos de cada simulacro.</p>`;
}

/** Índice id de tema → tema con el nombre de su bloque, para resolver `simulacros.temas`. */
function indiceTemas(temario) {
    const indice = new Map();
    for (const b of temario) for (const t of b.temas) indice.set(t.id, { ...t, bloque_nombre: b.nombre });
    return indice;
}

function etiquetaTemasSimulacro(s, indice) {
    const temas = s.temas.map((id) => indice.get(id)).filter(Boolean);
    if (temas.length === 1) return etiquetaTema(temas[0]);
    if (temas.length > 1) return `${temas.length} temas`;
    return `${s.temas.length} tema${s.temas.length === 1 ? "" : "s"}`;
}

function tarjetasSimulacros(simulacros, temario) {
    if (!simulacros.length)
        return html`<p class="empty">Todavía no has hecho ningún simulacro. <a href="/simulacro">Empieza uno</a>.</p>`;
    const indice = indiceTemas(temario);
    return html`<div class="simulacros-cards">${simulacros.map((s) => {
        const nota = (s.aciertos / s.total) * 10;
        return html`<article class="simulacro-card">
      <div class="simulacro-card-head"><span>${fechaCorta(s.fecha)}</span><b>${nota.toFixed(1)} / 10</b></div>
      <p class="hint">${etiquetaTemasSimulacro(s, indice)} · ${fmt(s.total)} preguntas</p>
      <p class="simulacro-card-datos"><span>${fmt(s.aciertos)} aciertos</span><span>${fmt(s.fallos)} fallos</span><span>${fmt(s.en_blanco)} blancos</span><span>${tiempo(s.segundos)}</span></p>
      <p class="hint">${Number(s.puntos).toFixed(2)} puntos</p>
    </article>`;
    })}</div>`;
}

function filaFallada(p) {
    const total = p.fallos + p.aciertos;
    return html`<a class="fallada" href="/maker?editar=${p.id}" title="Editar esta pregunta en el creador">
    <span class="fallada-tema">${etiquetaTema(p, { bloque: false, nombre: false })}${p.bloque_nombre ? html`<span>${p.bloque_nombre}</span>` : ""}</span>
    <span class="fallada-texto">${p.enunciado}</span>
    <span class="fallada-barra"><span class="bar" aria-hidden="true"><i class="b-bad" style="width:${total ? (p.fallos / total) * 100 : 0}%"></i><i class="b-ok" style="width:${total ? (p.aciertos / total) * 100 : 0}%"></i></span></span>
    <span class="fallada-cifras">${p.fallos} fallos · ${p.aciertos} aciertos</span>
  </a>`;
}

function bloqueFalladas(falladas) {
    if (!falladas.length)
        return html`<p class="empty">Todavía no hay fallos registrados. Haz un test o un simulacro para empezar.</p>`;
    const primeras = falladas.slice(0, 5);
    const resto = falladas.slice(5);
    return html`
    <div class="falladas-lista">${primeras.map(filaFallada)}</div>
    ${resto.length ? html`<details class="mini-tabla"><summary>Ver todas (${falladas.length})</summary><div class="falladas-lista">${resto.map(filaFallada)}</div></details>` : ""}`;
}

export function paginaEstadisticas({
    global,
    temas,
    prevision,
    falladas,
    actividad: act,
    racha = 0,
    semanas = [],
    tiempo: tiempoMedio = { ms: null, n: 0 },
    simulacros,
    totalSimulacros,
    temario = [],
    hoy,
    examen = null,
}) {
    const vistas = global.total - global.nuevas;
    const sinProgreso = global.nuevas === global.total;
    const aviso = !sinProgreso
        ? ""
        : totalSimulacros > 0
          ? `Todavía no has hecho ningún test, pero ya tienes ${fmt(totalSimulacros)} simulacro${totalSimulacros === 1 ? "" : "s"} registrado${totalSimulacros === 1 ? "" : "s"}. Abajo se muestran sus resultados; haz un test para empezar a registrar progreso de repaso.`
          : "Todavía no hay actividad registrada. Haz un test o un simulacro para empezar a ver datos.";
    const dominio = global.total ? Math.round((100 * global.dominadas) / global.total) : 0;
    const cuerpo = html`
  <main class="stack">
    <div class="page-head">
      <div>
        <h1>Estadísticas</h1>
        <p class="lede">Dónde estás fuerte, qué te cuesta y cuánto trabajo tienes por delante. Los datos salen de tus respuestas y de tus simulacros.</p>
      </div>
      <div class="row"><a class="btn primary" href="/">Hacer test</a><a class="btn" href="/simulacro">Simulacro</a></div>
    </div>

    ${aviso ? html`<div class="note">${aviso}</div>` : ""}
    ${examen && examen.fecha ? html`<div class="note">${textoExamen(examen)}</div>` : ""}

    <section class="kpis-principales" aria-label="Resumen principal">
      ${kpiPrincipal({
          etiqueta: "dominio",
          detalle: `${fmt(global.dominadas)} de ${fmt(global.total)} dominadas`,
          extra: global.total
              ? anillo({
                    valor: global.dominadas,
                    total: global.total,
                    titulo: "Dominio del banco",
                    texto: dominio + " %",
                    id: "dominio",
                })
              : html`<span class="kpi-n">—</span>`,
      })}
      ${kpiPrincipal({ valor: precision(global.aciertos, global.fallos), etiqueta: "precisión", detalle: `${fmt(global.aciertos)} aciertos · ${fmt(global.fallos)} fallos` })}
      ${kpiPrincipal({ valor: fmt(racha), etiqueta: racha === 1 ? "día de racha" : "días de racha", detalle: racha ? "días seguidos con respuestas" : "haz un test hoy para empezar" })}
      ${kpiPrincipal({ valor: fmt(global.repaso), etiqueta: "repasos hoy", detalle: global.repaso ? "preguntas vencidas o de hoy" : "nada pendiente por hoy" })}
    </section>

    <section class="kpis-secundarios" aria-label="Resumen secundario">
      <span><b>${fmt(vistas)} de ${fmt(global.total)}</b> vistas</span>
      <span><b>${tiempoMedio.ms != null ? (tiempoMedio.ms / 1000).toFixed(1) + " s" : "—"}</b> por pregunta</span>
      <span><b>${fmt(totalSimulacros)}</b> simulacros</span>
      <span><b>${fmt(global.total)}</b> preguntas</span>
    </section>

    <div class="stats-grid">
      <div class="stats-main stack">
        <section class="stack">
          <h2>Por tema</h2>
          <p class="hint">Pulsa una fila para ver sus cifras. La barra usa los mismos colores que las fichas de inicio.</p>
          ${temas.length ? tablaTemas(temas) : html`<p class="empty">Todavía no hay temas con preguntas.</p>`}
        </section>

        <section class="stack">
          <h2>Previsión de repasos</h2>
          <div class="card">${previsionRepasos(prevision, hoy)}</div>
        </section>

        <section class="stack">
          <h2>Actividad</h2>
          <div class="card">${bloqueActividad(act, hoy, racha)}</div>
        </section>

        <section class="stack">
          <h2>Preguntas que más fallas</h2>
          <p class="hint">Suma los fallos de los tests y de los simulacros. Pulsa una fila para editarla en el creador.</p>
          ${bloqueFalladas(falladas)}
        </section>
      </div>

      <aside class="stats-side stack">
        <section class="stack">
          <h2>Precisión por semana</h2>
          <div class="card">${precisionSemanal(semanas)}</div>
        </section>

        <section class="stack">
          <h2>Evolución de los simulacros</h2>
          <div class="card">${evolucionSimulacros(simulacros)}</div>
        </section>

        <section class="stack">
          <h2>Últimos simulacros</h2>
          ${tarjetasSimulacros(simulacros, temario)}
        </section>
      </aside>
    </div>
  </main>`;

    return layout({
        titulo: "Estadísticas",
        actual: "estadisticas",
        estado: "Guardado en la base de datos",
        ancho: true,
        css: ["estadisticas.css"],
        cuerpo,
    });
}
