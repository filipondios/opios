import { html } from "./html.js";
import { layout } from "./layout.js";
import { sumarDias } from "../fechas.js";
import { etiquetaTema } from "../etiquetas.js";

const fmt = (n) => Number(n ?? 0).toLocaleString("es-ES");
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) + " %" : "—");
const precision = (aciertos, fallos) => (aciertos + fallos > 0 ? pct(aciertos, aciertos + fallos) : "—");
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

function kpi(valor, etiqueta) {
  return html`<div class="kpi"><span class="kpi-n">${valor}</span><span class="kpi-l">${etiqueta}</span></div>`;
}

function tablaTemas(temas) {
  return porBloque(temas).map((b) => html`
    <section class="stats-bloque">
      <h2>${b.nombre}</h2>
      <div class="tabla-wrap">
        <table class="tabla">
          <thead><tr>
            <th>Tema</th><th>Total</th><th>Vistas</th><th>Dominadas</th><th>Aprendiendo</th>
            <th>Hoy</th><th>Aciertos</th><th>Fallos</th><th>Precisión</th>
          </tr></thead>
          <tbody>${b.temas.map((t) => html`
            <tr class="${t.repaso > 0 ? "fila-hoy" : ""}">
              <td><b>${etiquetaTema(t, { bloque: false, nombre: false })}</b>${t.tema_nombre ? html`<span class="tema-nombre">${t.tema_nombre}</span>` : ""}</td>
              <td>${fmt(t.total)}</td>
              <td>${fmt(t.total - t.nuevas)}</td>
              <td>${fmt(t.dominadas)}</td>
              <td>${fmt(t.aprendiendo)}</td>
              <td>${fmt(t.repaso)}</td>
              <td>${fmt(t.aciertos)}</td>
              <td>${fmt(t.fallos)}</td>
              <td>${precision(t.aciertos, t.fallos)}</td>
            </tr>`)}</tbody>
        </table>
      </div>
    </section>`);
}

function previsionRepasos(prevision, hoy) {
  const porFecha = new Map(prevision.map((f) => [f.vence, f.n]));
  const vencidas = prevision.filter((f) => f.vence < hoy).reduce((s, f) => s + f.n, 0);
  const dias = Array.from({ length: 7 }, (_, i) => {
    const fecha = sumarDias(hoy, i);
    return { fecha, n: porFecha.get(fecha) ?? 0 };
  });
  const max = Math.max(1, vencidas, ...dias.map((d) => d.n));
  return html`
    ${vencidas ? html`<div class="forecast-row vencidas">
      <span>Vencidas</span><span class="forecast-bar"><i style="width:${Math.round((vencidas / max) * 100)}%"></i></span><b>${fmt(vencidas)}</b>
    </div>` : ""}
    ${dias.map((d) => html`
      <div class="forecast-row">
        <span>${etiquetaDia(d.fecha, hoy)}</span>
        <span class="forecast-bar"><i style="width:${Math.round((d.n / max) * 100)}%"></i></span>
        <b>${fmt(d.n)}</b>
      </div>`)}`;
}

function actividad(actividad, hoy) {
  const porDia = new Map(actividad.map((a) => [a.dia, a.n]));
  const dias = Array.from({ length: 14 }, (_, i) => {
    const fecha = sumarDias(hoy, i - 13);
    return { fecha, n: porDia.get(fecha) ?? 0 };
  });
  const max = Math.max(1, ...dias.map((d) => d.n));
  return html`
    <div class="actividad" role="img" aria-label="Preguntas actualizadas por día en los últimos 14 días">
      ${dias.map((d) => html`<span class="actividad-dia" title="${fechaCorta(d.fecha)}: ${fmt(d.n)}"><i class="actividad-barra" style="height:${Math.max(2, Math.round((d.n / max) * 100))}%"></i></span>`)}
    </div>
    <p class="hint">Del ${fechaCorta(dias[0].fecha)} al ${fechaCorta(dias[dias.length - 1].fecha)} · preguntas actualizadas por día</p>`;
}

function tablaFalladas(falladas) {
  if (!falladas.length) return html`<p class="empty">Todavía no hay fallos registrados. Haz un test o un simulacro para empezar.</p>`;
  return html`<div class="tabla-wrap">
    <table class="tabla">
      <thead><tr><th>Tema</th><th>Pregunta</th><th>Fallos</th><th>Aciertos</th><th>Caja</th></tr></thead>
      <tbody>${falladas.map((p) => html`
        <tr>
          <td>${p.bloque_nombre ? html`<span class="tema-nombre">${p.bloque_nombre}</span>` : ""}<b>${etiquetaTema(p, { bloque: false, nombre: false })}</b></td>
          <td class="pregunta-cell">${p.enunciado}</td>
          <td><b>${fmt(p.fallos)}</b></td>
          <td>${fmt(p.aciertos)}</td>
          <td>${p.caja ?? "—"}</td>
        </tr>`)}</tbody>
    </table>
  </div>`;
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

function tablaSimulacros(simulacros, temario) {
  if (!simulacros.length) return html`<p class="empty">Todavía no has hecho ningún simulacro. <a href="/simulacro">Empieza uno</a>.</p>`;
  const indice = indiceTemas(temario);
  return html`<div class="tabla-wrap">
    <table class="tabla">
      <thead><tr><th>Fecha</th><th>Temas</th><th>Preguntas</th><th>Aciertos</th><th>Fallos</th><th>Blancos</th><th>Puntos</th><th>Tiempo</th></tr></thead>
      <tbody>${simulacros.map((s) => html`
        <tr>
          <td>${fechaCorta(s.fecha)}</td>
          <td>${etiquetaTemasSimulacro(s, indice)}</td>
          <td>${fmt(s.total)}</td>
          <td>${fmt(s.aciertos)}</td>
          <td>${fmt(s.fallos)}</td>
          <td>${fmt(s.en_blanco)}</td>
          <td><b>${Number(s.puntos).toFixed(2)}</b></td>
          <td>${tiempo(s.segundos)}</td>
        </tr>`)}</tbody>
    </table>
  </div>`;
}

export function paginaEstadisticas({ global, temas, prevision, falladas, actividad: act, simulacros, totalSimulacros, temario = [], hoy }) {
  const vistas = global.total - global.nuevas;
  const sinProgreso = global.nuevas === global.total;
  const aviso = !sinProgreso
    ? ""
    : totalSimulacros > 0
      ? `Todavía no has hecho ningún test, pero ya tienes ${fmt(totalSimulacros)} simulacro${totalSimulacros === 1 ? "" : "s"} registrado${totalSimulacros === 1 ? "" : "s"}. Abajo se muestran sus resultados; haz un test para empezar a registrar progreso de repaso.`
      : "Todavía no hay actividad registrada. Haz un test o un simulacro para empezar a ver datos.";
  const cuerpo = html`
  <main class="stack">
    <div class="page-head">
      <div>
        <h1>Estadísticas</h1>
        <p class="lede">Dónde estás fuerte, qué te cuesta y cuánto trabajo tienes por delante. Los datos salen de tu progreso y de tus simulacros.</p>
      </div>
      <div class="row"><a class="btn primary" href="/">Hacer test</a><a class="btn" href="/simulacro">Simulacro</a></div>
    </div>

    ${aviso ? html`<div class="note">${aviso}</div>` : ""}

    <section class="kpis" aria-label="Resumen">
      ${kpi(fmt(global.total), "preguntas")}
      ${kpi(`${fmt(vistas)} · ${pct(vistas, global.total)}`, "vistas")}
      ${kpi(fmt(global.dominadas), "dominadas")}
      ${kpi(precision(global.aciertos, global.fallos), "precisión")}
      ${kpi(fmt(global.repaso), "repasos hoy")}
      ${kpi(fmt(totalSimulacros), "simulacros")}
    </section>

    <section class="stack">
      <h2>Por tema</h2>
      ${temas.length ? tablaTemas(temas) : html`<p class="empty">Todavía no hay temas con preguntas.</p>`}
    </section>

    <section class="stack">
      <h2>Previsión de repasos</h2>
      <div class="card">${previsionRepasos(prevision, hoy)}</div>
    </section>

    <section class="stack">
      <h2>Preguntas que más fallas</h2>
      <p class="hint">Suma los fallos de los tests y de los simulacros. La caja solo existe en las preguntas practicadas en test; «—» indica que solo han salido en simulacros.</p>
      ${tablaFalladas(falladas)}
    </section>

    <section class="stack">
      <h2>Actividad</h2>
      <div class="card">${actividad(act, hoy)}</div>
    </section>

    <section class="stack">
      <h2>Últimos simulacros</h2>
      ${tablaSimulacros(simulacros, temario)}
    </section>
  </main>`;

  return layout({
    titulo: "Estadísticas",
    marca: "Estadísticas",
    enlaces: [
      { href: "/", texto: "Hacer test" },
      { href: "/simulacro", texto: "Simulacro" },
      { href: "/temario", texto: "Temario" },
      { href: "/maker", texto: "Añadir preguntas" },
    ],
    estado: "Guardado en la base de datos",
    ancho: true,
    css: ["estadisticas.css"],
    cuerpo,
  });
}
