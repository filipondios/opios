/* Motor del repaso espaciado, independiente de la UI y del DOM.
   Lo usa public/js/test.js en el navegador y test/repaso.test.js en bun:test.
   La fecha (`hoy`) y el azar (`azar`) se inyectan para poder probarlo de forma determinista. */

/* ---------- Parámetros del repaso (ajústalos a tu gusto) ---------- */
export const INTERVALOS_DIAS = [0, 1, 3, 7, 16, 35, 90]; // días hasta el siguiente repaso según la caja (7 cajas: 0..6)
export const PASOS_APRENDIZAJE = [3, 8]; // tras fallar: reaparece tras 3 preguntas, luego tras 8
export const PROB_REPASO = 0.6; // si hay repasos y nuevas a la vez, probabilidad de sacar un repaso

/** Fecha local en formato AAAA-MM-DD. */
export const iso = (d) =>
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

/** Fecha de hoy (o de `d`) en formato AAAA-MM-DD. */
export const hoyIso = (d = new Date()) => iso(d);

/** Suma días a una fecha AAAA-MM-DD y devuelve otra fecha AAAA-MM-DD. */
export function sumarDias(fecha, dias) {
    const [anio, mes, dia] = String(fecha).split("-").map(Number);
    return iso(new Date(anio, mes - 1, dia + dias));
}

/** Elige un elemento al azar. `azar` se inyecta para que los tests sean deterministas. */
function elegir(lista, azar) {
    return lista[Math.min(lista.length - 1, Math.floor(azar() * lista.length))];
}

export class Sesion {
    /**
     * @param {Array<{i:number}>} pool preguntas disponibles; `i` es el id.
     * @param {object} opciones
     * @param {Record<number, [number,string,number,number]>} opciones.progreso id -> [caja, vence, aciertos, fallos]
     * @param {() => string} opciones.hoy fecha actual AAAA-MM-DD
     * @param {() => number} opciones.azar generador en [0, 1)
     * @param {(id:number) => void} opciones.alCambiar callback tras registrar una respuesta
     * @param {number} opciones.nuevasPermitidas cupo de preguntas nuevas que aún se pueden introducir hoy
     * @param {number} opciones.topeIntervalo días máximos hasta el próximo repaso (0 = sin tope; Fase 3.6)
     */
    constructor(
        pool,
        {
            progreso = {},
            hoy = hoyIso,
            azar = Math.random,
            alCambiar = () => {},
            nuevasPermitidas = Infinity,
            topeIntervalo = 0,
        } = {},
    ) {
        this.pool = pool;
        this.progreso = progreso;
        this.hoy = hoy;
        this.azar = azar;
        this.alCambiar = alCambiar;
        this.nuevasPermitidas = nuevasPermitidas;
        this.topeIntervalo = topeIntervalo;
        this.porId = new Map(pool.map((q) => [q.i, q]));
        this.n = 0;
        this.aprendizaje = new Map();
        this.ultima = null;
        this.introducidas = new Set();
        this.aciertos = 0;
        this.fallos = 0;
    }

    /** Días hasta el próximo repaso desde la caja indicada, con el tope de la fecha de examen si lo hay. */
    intervalo(caja) {
        const dias = INTERVALOS_DIAS[caja];
        return this.topeIntervalo > 0 ? Math.min(dias, this.topeIntervalo) : dias;
    }

    siguiente() {
        const hoyIso = this.hoy();
        // 1) preguntas falladas cuyo turno ya llegó
        let mejor = null;
        for (const [id, [, v]] of this.aprendizaje) if (v <= this.n && (!mejor || v < mejor.v)) mejor = { id, v };
        if (mejor) return [this.porId.get(mejor.id), "Reintento"];
        // 2) repasos vencidos y 3) nuevas (respetando el cupo diario)
        const repasos = [],
            nuevas = [];
        for (const q of this.pool) {
            const p = this.progreso[q.i];
            if (!p) nuevas.push(q);
            else if (!this.aprendizaje.has(q.i) && p[1] <= hoyIso) repasos.push(q);
        }
        const quedanNuevas = this.nuevasPermitidas === Infinity || this.introducidas.size < this.nuevasPermitidas;
        if (repasos.length && (!nuevas.length || !quedanNuevas || this.azar() < PROB_REPASO)) {
            const menor = repasos.reduce(
                (m, q) => (this.progreso[q.i][1] < m ? this.progreso[q.i][1] : m),
                "9999-99-99",
            );
            return [
                elegir(
                    repasos.filter((q) => this.progreso[q.i][1] === menor),
                    this.azar,
                ),
                "Repaso",
            ];
        }
        if (nuevas.length && quedanNuevas) {
            const q = elegir(nuevas, this.azar);
            this.introducidas.add(q.i);
            return [q, "Nueva"];
        }
        // 4) nada pendiente salvo reintentos que aún no tocan
        if (this.aprendizaje.size) {
            let m = null;
            for (const [id, [, v]] of this.aprendizaje) if (!m || v < m.v) m = { id, v };
            return [this.porId.get(m.id), "Reintento"];
        }
        // 5) modo libre infinito: más peso a las cajas bajas y a las más falladas
        let cand = this.pool.filter((q) => this.progreso[q.i] && q.i !== this.ultima);
        if (!cand.length) cand = this.pool.filter((q) => this.progreso[q.i]);
        if (!cand.length) cand = this.pool;
        const pesos = cand.map((q) => {
            const p = this.progreso[q.i] || [0, hoyIso, 0, 0];
            return 1 / (p[0] + 1) + (0.3 * p[3]) / Math.max(1, p[2] + p[3]);
        });
        let r = this.azar() * pesos.reduce((a, b) => a + b, 0);
        for (let k = 0; k < cand.length; k++) {
            r -= pesos[k];
            if (r <= 0) return [cand[k], "Práctica libre"];
        }
        return [cand[cand.length - 1], "Práctica libre"];
    }

    registrar(q, acierto) {
        const id = q.i,
            existia = !!this.progreso[id];
        const p = this.progreso[id] || (this.progreso[id] = [0, this.hoy(), 0, 0]);
        this.n++;
        this.ultima = id;
        if (acierto) {
            this.aciertos++;
            p[2]++;
            if (this.aprendizaje.has(id)) {
                const paso = this.aprendizaje.get(id)[0] + 1;
                if (paso >= PASOS_APRENDIZAJE.length) {
                    this.aprendizaje.delete(id);
                    if (p[0] === 0) p[0] = 1; // progreso antiguo en caja 0
                    p[1] = sumarDias(this.hoy(), this.intervalo(p[0]));
                } else this.aprendizaje.set(id, [paso, this.n + PASOS_APRENDIZAJE[paso]]);
            } else if (existia && p[0] === 0) {
                // fallada en una sesión anterior: un reintento más antes de graduarla
                this.aprendizaje.set(id, [1, this.n + PASOS_APRENDIZAJE[1]]);
            } else if (existia && p[1] > this.hoy()) {
                // práctica libre: no estaba vencida; no toca caja ni fecha
            } else {
                p[0] = Math.min(p[0] + 1, INTERVALOS_DIAS.length - 1);
                p[1] = sumarDias(this.hoy(), this.intervalo(p[0]));
            }
        } else {
            this.fallos++;
            p[3]++;
            p[0] = Math.max(1, p[0] - 2);
            p[1] = this.hoy();
            this.aprendizaje.set(id, [0, this.n + PASOS_APRENDIZAJE[0]]);
        }
        this.alCambiar(id);
    }

    pendientes() {
        const hoyIso = this.hoy();
        let rep = 0,
            nue = 0;
        for (const q of this.pool) {
            const p = this.progreso[q.i];
            if (!p) nue++;
            else if (p[1] <= hoyIso) rep++;
        }
        return { rep, nue };
    }
}
