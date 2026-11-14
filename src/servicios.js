/* Contrato del núcleo (servicios, API, web): solo los métodos públicos del repo, los que
   exporta `abrirDb()`. Prohibido aquí: la conexión (`repo.db`), sus primitivas de bajo
   nivel (`query`/`run`/`transaction`) y las APIs de Bun (`bun:sqlite`, `Bun.*`) — son
   del adaptador de almacenamiento (`src/db/`) y del adaptador HTTP (`src/http.js`).
   `test/contratos.test.js` lo comprueba. Cumplirlo permite portar el núcleo a Android. */
import { CAJA_DOMINADA, APP_TZ, FACTOR_EXAMEN } from "./config.js";
import { hoyIso, diasEntre } from "./fechas.js";

/** Capa de servicios: cálculos que la API y las páginas comparten. */
export function crearServicios(repo, { ahora = () => new Date(), zona = APP_TZ } = {}) {
    const fechaHoy = () => hoyIso(ahora(), zona);
    const estadisticas = () => repo.estadisticasTemas(fechaHoy(), CAJA_DOMINADA);
    /** Temario con las cifras de repaso de cada tema (para barras y bloques plegables). */
    const temarioConProgreso = () => {
        const porTema = new Map(estadisticas().map((e) => [e.tema, e]));
        return repo.temario().map((b) => ({
            ...b,
            temas: b.temas.map((t) => ({ ...t, ...(porTema.get(t.id) ?? {}) })),
        }));
    };

    /**
     * Fecha de examen y tope de intervalo asociado (Fase 3.6): el intervalo de repaso no debe
     * superar ~FACTOR_EXAMEN del tiempo que queda, según Cepeda et al. (2008).
     */
    function infoExamen() {
        const { fecha_examen: fecha } = repo.ajustes();
        if (!fecha) return { fecha: null, dias: null, topeDias: 0 };
        const dias = diasEntre(fechaHoy(), fecha);
        if (dias <= 0) return { fecha, dias, topeDias: 0 };
        return { fecha, dias, topeDias: Math.max(1, Math.round(FACTOR_EXAMEN * dias)) };
    }

    return { fechaHoy, estadisticas, temarioConProgreso, infoExamen };
}
