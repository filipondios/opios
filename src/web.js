import { sumarDias } from "./fechas.js";
import { CAJA_DOMINADA } from "./config.js";
import { aTexto } from "./views/html.js";
import { paginaHome, temasGrid } from "./views/home.js";
import { paginaMaker } from "./views/maker.js";
import { paginaTemario } from "./views/temario.js";
import { paginaEstadisticas } from "./views/estadisticas.js";
import { paginaSimulacro } from "./views/simulacro.js";
import { paginaNoEncontrada } from "./views/error.js";

/** Páginas SSR (GET/HEAD, sin /api/). Devuelve null si la ruta no es una página: el adaptador
    HTTP prueba entonces con los archivos estáticos. `banco` (F1.5) es el id del banco activo:
    viaja al cliente para prefijar las claves de localStorage dependientes del banco. */
export function crearWeb(repo, servicios, { banco = null } = {}) {
    const { fechaHoy, estadisticas, infoExamen } = servicios;

    const pagina = (r, status = 200) => {
        const html = aTexto(r);
        return new Response(
            banco
                ? html.replace("<head>", `<head><script>globalThis.__opiosBancoId=${JSON.stringify(banco)}</script>`)
                : html,
            { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
        );
    };

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
