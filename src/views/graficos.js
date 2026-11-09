import { sumarDias } from "../fechas.js";
import { html } from "./html.js";

/* Gráficos de servidor: SVG puro, sin dependencias. Cada función devuelve HTML ya escapado
   (o un estado vacío), con título y descripción accesibles y los valores también en texto. */

const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
};
const pct = (v, total) => (total > 0 ? Math.max(0, Math.min(100, (n(v) / total) * 100)) : 0);
const decimal = (v) => (Math.round(n(v) * 100) / 100).toLocaleString("es-ES");
const sinDatos = (mensaje) => html`<p class="empty">${mensaje}</p>`;

/** Barra apilada (dominadas / aprendiendo / nuevas). */
export function barraApilada({ dominadas = 0, aprendiendo = 0, nuevas = 0, total = 0, etiqueta = "Progreso" }) {
    const t = Math.max(0, n(total), n(dominadas) + n(aprendiendo) + n(nuevas));
    if (!t) return sinDatos("Sin preguntas todavía.");
    const d = Math.min(t, Math.max(0, n(dominadas)));
    const a = Math.min(t - d, Math.max(0, n(aprendiendo)));
    const v = Math.max(0, t - d - a);
    return html`<span class="bar" role="img" aria-label="${etiqueta}: ${d} dominadas, ${a} en aprendizaje, ${v} nuevas de ${t}">
    <i class="b-ok" style="width:${pct(d, t)}%"></i><i class="b-mid" style="width:${pct(a, t)}%"></i><i class="b-new" style="width:${pct(v, t)}%"></i>
  </span>`;
}

/** Columnas verticales (previsión de 7 días, etc.). El día actual se resalta. */
export function columnas({ datos = [], titulo = "Columnas", descripcion = "", id = "columnas" }) {
    if (!datos.length) return sinDatos("No hay datos para mostrar.");
    const max = Math.max(1, ...datos.map((d) => Math.max(0, n(d.valor))));
    const ancho = 320;
    const alto = 132;
    const margen = 18;
    const base = alto - 28;
    const paso = (ancho - margen * 2) / datos.length;
    const barras = datos.map((d, i) => {
        const valor = Math.max(0, n(d.valor));
        const h = valor ? Math.max(2, (valor / max) * (base - 18)) : 0;
        const x = margen + i * paso + paso * 0.15;
        const w = paso * 0.7;
        const y = base - h;
        const clase = d.hoy ? "col-hoy" : "col";
        return html`<g class="${clase}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" class="col-barra"></rect>
      <text x="${x + w / 2}" y="${base + 15}" text-anchor="middle" class="col-etiqueta">${d.etiqueta ?? ""}</text>
      <text x="${x + w / 2}" y="${Math.max(12, y - 5)}" text-anchor="middle" class="col-valor">${valor}</text>
    </g>`;
    });
    return html`<figure class="grafico"><svg viewBox="0 0 ${ancho} ${alto}" role="img" aria-labelledby="${id}-t ${id}-d" preserveAspectRatio="xMidYMid meet">
    <title id="${id}-t">${titulo}</title><desc id="${id}-d">${descripcion || datos.map((d) => `${d.etiqueta}: ${n(d.valor)}`).join("; ")}</desc>
    <line x1="${margen}" y1="${base}" x2="${ancho - margen}" y2="${base}" class="eje"></line>
    ${barras}
  </svg></figure>`;
}

/** Mapa de calor de actividad (por defecto, 12 semanas). */
export function mapaCalor({ datos = [], hoy, semanas = 12, titulo = "Actividad", descripcion = "", id = "calor" }) {
    if (!datos.length) return sinDatos("Sin respuestas registradas todavía.");
    const porFecha = new Map(datos.map((d) => [String(d.fecha), n(d.valor)]));
    const fin = hoy || (datos.length ? String(datos[datos.length - 1].fecha) : null);
    if (!fin) return sinDatos("Todavía no hay actividad registrada.");
    const dias = Math.max(1, semanas) * 7;
    const inicio = sumarDias(fin, -(dias - 1));
    const desfase = (new Date(inicio + "T12:00:00").getDay() + 6) % 7;
    const celdas = [];
    let max = 1;
    for (let i = 0; i < dias; i++) {
        const fecha = sumarDias(inicio, i);
        const valor = porFecha.get(fecha) ?? 0;
        max = Math.max(max, valor);
        celdas.push({ fecha, valor, col: Math.floor((i + desfase) / 7), fila: (i + desfase) % 7 });
    }
    const lado = 12;
    const hueco = 3;
    const ancho = 16 * (lado + hueco) + 8;
    const alto = 7 * (lado + hueco) + 30;
    const total = celdas.reduce((s, c) => s + c.valor, 0);
    const rects = celdas.map((c) => {
        const nivel = c.valor ? Math.max(0.18, c.valor / max) : 0;
        const x = 4 + c.col * (lado + hueco);
        const y = 4 + c.fila * (lado + hueco);
        return html`<rect x="${x}" y="${y}" width="${lado}" height="${lado}" rx="2.5" class="calor-celda" data-n="${c.valor}" opacity="${nivel || 0.06}"><title>${c.fecha}: ${c.valor}</title></rect>`;
    });
    return html`<figure class="grafico"><svg viewBox="0 0 ${ancho} ${alto}" role="img" aria-labelledby="${id}-t ${id}-d" preserveAspectRatio="xMidYMid meet">
    <title id="${id}-t">${titulo}</title><desc id="${id}-d">${descripcion || `${total} respuestas en las últimas ${dias} días`}</desc>
    ${rects}
    <text x="4" y="${alto - 8}" class="col-etiqueta">${inicio}</text><text x="${ancho - 4}" y="${alto - 8}" text-anchor="end" class="col-etiqueta">${fin}</text>
  </svg></figure>`;
}

/** Línea con puntos (precisión semanal, notas de simulacro). */
export function linea({ puntos = [], titulo = "Evolución", descripcion = "", id = "linea", maximo = null }) {
    if (!puntos.length) return sinDatos("No hay datos para mostrar.");
    const ancho = 320;
    const alto = 132;
    const margen = 18;
    const base = alto - 28;
    const max = Math.max(1, n(maximo) || 0, ...puntos.map((p) => Math.max(0, n(p.valor))));
    const paso = puntos.length > 1 ? (ancho - margen * 2) / (puntos.length - 1) : 0;
    const coord = puntos.map((p, i) => ({
        x: puntos.length === 1 ? ancho / 2 : margen + i * paso,
        y: base - (Math.max(0, n(p.valor)) / max) * (base - 18),
        ...p,
    }));
    const trazo = coord.map((c) => `${c.x},${c.y}`).join(" ");
    const circulos = coord.map(
        (c) =>
            html`<circle cx="${c.x}" cy="${c.y}" r="3.5" class="punto"><title>${c.etiqueta ?? ""}: ${decimal(c.valor)}</title></circle>`,
    );
    return html`<figure class="grafico"><svg viewBox="0 0 ${ancho} ${alto}" role="img" aria-labelledby="${id}-t ${id}-d" preserveAspectRatio="xMidYMid meet">
    <title id="${id}-t">${titulo}</title><desc id="${id}-d">${descripcion || puntos.map((p) => `${p.etiqueta}: ${decimal(p.valor)}`).join("; ")}</desc>
    <line x1="${margen}" y1="${base}" x2="${ancho - margen}" y2="${base}" class="eje"></line>
    ${coord.length > 1 ? html`<polyline points="${trazo}" class="trazo"></polyline>` : ""}
    ${circulos}
    <text x="${margen}" y="${base + 15}" class="col-etiqueta">${puntos[0].etiqueta ?? ""}</text>
    <text x="${ancho - margen}" y="${base + 15}" text-anchor="end" class="col-etiqueta">${puntos[puntos.length - 1].etiqueta ?? ""}</text>
  </svg></figure>`;
}

/** Anillo de progreso con la cifra en el centro. */
export function anillo({ valor = 0, total = 0, titulo = "Progreso", texto = null, id = "anillo" }) {
    const t = Math.max(0, n(total));
    if (!t) return sinDatos("Sin datos todavía.");
    const v = Math.max(0, Math.min(t, n(valor)));
    const p = pct(v, t);
    const r = 32;
    const c = 2 * Math.PI * r;
    const centro = texto ?? `${v}/${t}`;
    return html`<figure class="grafico anillo"><svg viewBox="0 0 84 84" role="img" aria-labelledby="${id}-t ${id}-d">
    <title id="${id}-t">${titulo}</title><desc id="${id}-d">${v} de ${t} (${Math.round(p)} %)</desc>
    <circle cx="42" cy="42" r="${r}" class="anillo-fondo"></circle>
    <circle cx="42" cy="42" r="${r}" class="anillo-valor" stroke-dasharray="${c}" stroke-dashoffset="${c - (c * p) / 100}" transform="rotate(-90 42 42)"></circle>
    <text x="42" y="47" text-anchor="middle" class="anillo-texto">${centro}</text>
  </svg></figure>`;
}
