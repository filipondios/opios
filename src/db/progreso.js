import { CUPO_NUEVAS, FRENO_ATRASO } from "../config.js";
import { sumarDias } from "../fechas.js";

/** Progreso del repaso, respuestas registradas, estadísticas y ajustes. */
export function crearProgreso({ db, q }) {
    return {
        /** Resumen por tema (agrupado por bloque) para la pantalla de selección. `hoy` = AAAA-MM-DD. */
        estadisticasTemas(hoy, cajaDominada) {
            return db
                .query(`
        SELECT p.tema_id AS tema, t.numero AS tema_numero, t.nombre AS tema_nombre,
               t.bloque_id AS bloque, b.nombre AS bloque_nombre, b.numero AS bloque_numero,
               COALESCE(b.orden, 2147483647) AS bloque_orden, COUNT(*) AS total,
               COALESCE(SUM(pr.pregunta_id IS NULL), 0) AS nuevas,
               COALESCE(SUM(pr.vence <= ?), 0)          AS repaso,
               COALESCE(SUM(pr.caja >= ?), 0)           AS dominadas,
               COALESCE(SUM(pr.caja < ?), 0)            AS aprendiendo,
               COALESCE(SUM(pr.aciertos), 0)            AS aciertos,
               COALESCE(SUM(pr.fallos), 0)              AS fallos
        FROM preguntas p
        JOIN temas t ON t.id = p.tema_id
        LEFT JOIN bloques b ON b.id = t.bloque_id
        LEFT JOIN progreso pr ON pr.pregunta_id = p.id
        GROUP BY p.tema_id
        ORDER BY COALESCE(b.orden, 2147483647), COALESCE(t.numero, t.id), p.tema_id`)
                .all(hoy, cajaDominada, cajaDominada);
        },

        guardarProgreso: db.transaction((entradas) => {
            for (const e of entradas) q.upsertProgreso.run(e.id, e.caja, e.vence, e.aciertos, e.fallos);
        }),

        reiniciarProgreso: () => {
            q.borrarProgreso.run();
            db.run("DELETE FROM respuestas");
        },

        /** Registra un lote de respuestas del test. Devuelve cuántas se han insertado. */
        registrarRespuestas: db.transaction((entradas, hoy, origen = "test") => {
            let n = 0;
            for (const e of entradas) n += q.insertarRespuesta.run(e.id, hoy, e.acierto, origen, e.ms ?? null).changes;
            return n;
        }),

        /** Totales globales de progreso, para la cabecera de la página de estadísticas. */
        estadisticasGlobales(hoy, cajaDominada) {
            return db
                .query(`
        SELECT COUNT(*) AS total,
               COALESCE(SUM(pr.pregunta_id IS NULL), 0)                  AS nuevas,
               COALESCE(SUM(pr.caja >= ?), 0)                            AS dominadas,
               COALESCE(SUM(pr.caja < ? AND pr.pregunta_id IS NOT NULL), 0) AS aprendiendo,
               COALESCE(SUM(pr.vence <= ?), 0)                           AS repaso,
               COALESCE(SUM(pr.aciertos), 0)                             AS aciertos,
               COALESCE(SUM(pr.fallos), 0)                               AS fallos
        FROM preguntas p LEFT JOIN progreso pr ON pr.pregunta_id = p.id`)
                .get(cajaDominada, cajaDominada, hoy);
        },

        /** Repasos agrupados por fecha de vencimiento, desde el pasado hasta `hoy + dias - 1`. */
        previsionRepasos(hoy, dias = 7) {
            const hasta = sumarDias(hoy, Math.max(1, dias) - 1);
            return db
                .query(`
        SELECT vence, COUNT(*) AS n FROM progreso
        WHERE vence <= ? GROUP BY vence ORDER BY vence`)
                .all(hasta);
        },

        /** Preguntas con más fallos. Los fallos de test y de simulacro viven todos en `progreso`. */
        preguntasMasFalladas(limite = 20) {
            return db
                .query(`
        SELECT p.id, p.enunciado, t.numero AS tema_numero, t.nombre AS tema_nombre,
               b.nombre AS bloque_nombre,
               COALESCE(pr.fallos, 0)   AS fallos,
               COALESCE(pr.aciertos, 0) AS aciertos,
               pr.caja
        FROM preguntas p
        JOIN temas t ON t.id = p.tema_id
        LEFT JOIN bloques b ON b.id = t.bloque_id
        LEFT JOIN progreso pr ON pr.pregunta_id = p.id
        WHERE COALESCE(pr.fallos, 0) > 0
        ORDER BY fallos DESC, aciertos ASC, p.id
        LIMIT ?`)
                .all(limite);
        },

        /** Respuestas por día desde `desde` (AAAA-MM-DD), con el desglose acierto/fallo. */
        actividadReciente(desde) {
            return db
                .query(`
        SELECT fecha AS dia, COUNT(*) AS n,
               COALESCE(SUM(acierto = 1), 0) AS aciertos,
               COALESCE(SUM(acierto = 0), 0) AS fallos
        FROM respuestas
        WHERE fecha >= ?
        GROUP BY fecha ORDER BY fecha`)
                .all(desde);
        },

        /**
         * Carga del día para los límites de Fase 3:
         * `nuevasHoy` cuenta las preguntas cuya primera respuesta registrada es de hoy y vino de un test
         * (los simulacros no consumen cupo). `bloqueadoPorAtraso` frena las nuevas si hay demasiados repasos atrasados.
         */
        cargaDiaria(hoy) {
            const nuevasHoy = db
                .query(`
        SELECT COUNT(*) AS n FROM respuestas r
        WHERE r.origen = 'test' AND r.fecha = ?
          AND NOT EXISTS (SELECT 1 FROM respuestas r2 WHERE r2.pregunta_id = r.pregunta_id AND r2.id < r.id)`)
                .get(hoy).n;
            const repasosPendientes = db.query("SELECT COUNT(*) AS n FROM progreso WHERE vence <= ?").get(hoy).n;
            const repasosAtrasados = db.query("SELECT COUNT(*) AS n FROM progreso WHERE vence < ?").get(hoy).n;
            return {
                nuevasHoy,
                cupoNuevas: CUPO_NUEVAS,
                repasosPendientes,
                repasosAtrasados,
                bloqueadoPorAtraso: repasosAtrasados > FRENO_ATRASO * CUPO_NUEVAS,
            };
        },

        /** Días consecutivos con al menos una respuesta, terminando hoy (o ayer si hoy aún no hay actividad). */
        rachaDias(hoy) {
            const fechas = new Set(
                db
                    .query("SELECT DISTINCT fecha FROM respuestas")
                    .all()
                    .map((r) => r.fecha),
            );
            let dia = fechas.has(hoy) ? hoy : sumarDias(hoy, -1);
            let racha = 0;
            while (fechas.has(dia)) {
                racha++;
                dia = sumarDias(dia, -1);
            }
            return racha;
        },

        /** Precisión agrupada por semanas (de lunes a domingo) de las últimas `semanas`. */
        precisionSemanal(hoy, semanas = 8) {
            const desde = sumarDias(hoy, -(Math.max(1, semanas) * 7 - 1));
            const filas = db
                .query(
                    `SELECT fecha, COUNT(*) AS n, COALESCE(SUM(acierto), 0) AS aciertos
         FROM respuestas WHERE fecha >= ? GROUP BY fecha`,
                )
                .all(desde);
            const inicioSemana = (fecha) => sumarDias(fecha, -((new Date(fecha + "T12:00:00").getDay() + 6) % 7));
            const mapa = new Map();
            for (const f of filas) {
                const s = inicioSemana(f.fecha);
                const g = mapa.get(s) ?? { desde: s, hasta: sumarDias(s, 6), aciertos: 0, fallos: 0 };
                g.aciertos += f.aciertos;
                g.fallos += f.n - f.aciertos;
                mapa.set(s, g);
            }
            return [...mapa.values()].sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0));
        },

        /** Tiempo medio de respuesta en ms (solo tests, que sí miden `ms`). */
        tiempoMedio() {
            const r = db.query("SELECT AVG(ms) AS ms, COUNT(*) AS n FROM respuestas WHERE ms IS NOT NULL").get();
            return { ms: r.n ? Math.round(r.ms) : null, n: r.n };
        },

        /** Ajustes de la instancia como objeto clave/valor (por ahora, `fecha_examen`). */
        ajustes() {
            const filas = db.query("SELECT clave, valor FROM ajustes").all();
            return Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
        },

        /** Guarda (o borra, con valor vacío) un ajuste. */
        guardarAjuste: db.transaction((clave, valor) => {
            if (valor == null || valor === "") db.query("DELETE FROM ajustes WHERE clave = ?").run(clave);
            else
                db.query(`INSERT INTO ajustes (clave, valor) VALUES (?, ?)
                     ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor`).run(clave, valor);
        }),
    };
}
