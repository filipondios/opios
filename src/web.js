import { sumarDias } from "./fechas.js";
import { CAJA_DOMINADA } from "./config.js";
import { aTexto } from "./views/html.js";
import { paginaHome, temasGrid } from "./views/home.js";
import { paginaMaker } from "./views/maker.js";
import { paginaTemario } from "./views/temario.js";
import { paginaEstadisticas } from "./views/estadisticas.js";
import { paginaSimulacro } from "./views/simulacro.js";
import { paginaNoEncontrada } from "./views/error.js";

const pagina = (r, status = 200) =>
    new Response(aTexto(r), {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });

/** Páginas SSR (GET/HEAD, sin /api/). Devuelve null si la ruta no es una página: el adaptador
    HTTP prueba entonces con los archivos estáticos. */
export function crearWeb(repo, servicios) {
    const { fechaHoy, estadisticas, infoExamen } = servicios;

    return async function web(ruta) {
        if (ruta === "/")
            return pagina(
                paginaHome({ temas: estadisticas(), carga: repo.cargaDiaria(fechaHoy()), examen: infoExamen() }),
            );
        if (ruta === "/maker") return pagina(paginaMaker({ temario: repo.temario() }));
        if (ruta === "/temario") return pagina(paginaTemario());
        if (ruta === "/simulacro")
            return pagina(paginaSimulacro({ temario: repo.temario(), estadisticas: estadisticas() }));
        if (ruta === "/estadisticas") {
            const hoy = fechaHoy();
            return pagina(
                paginaEstadisticas({
                    global: repo.estadisticasGlobales(hoy, CAJA_DOMINADA),
                    temas: estadisticas(),
                    prevision: repo.previsionRepasos(hoy, 7),
                    falladas: repo.preguntasMasFalladas(20),
                    actividad: repo.actividadReciente(sumarDias(hoy, -83)),
                    racha: repo.rachaDias(hoy),
                    semanas: repo.precisionSemanal(hoy, 8),
                    tiempo: repo.tiempoMedio(),
                    simulacros: repo.listarSimulacros(5),
                    totalSimulacros: repo.contarSimulacros(),
                    temario: repo.temario(),
                    hoy,
                    examen: infoExamen(),
                }),
            );
        }
        if (ruta === "/fragmentos/temas") return pagina(temasGrid(estadisticas(), repo.cargaDiaria(fechaHoy())));
        return null;
    };
}
