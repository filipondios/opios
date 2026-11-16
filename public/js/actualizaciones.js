/* Aviso de versión (7.5): consulta la última release de GitHub una vez al día, compara con
   la versión nativa y muestra las notas. Sin red, sin plugin o sin versión nueva: no hace nada. */
import { h, leerJsonExterna, msgError } from "./comun.js";

const URL_RELEASES = "https://api.github.com/repos/filipondios/opios/releases/latest";
const CLAVE_DIA = "opios.aviso-version";

/** ¿Es mayor la versión de la release que la instalada? (`v1.2.3` vs `1.2.3`). */
export const esMayor = (tag, actual) => {
    const numeros = (s) =>
        String(s ?? "")
            .replace(/^v/, "")
            .split(/[.-]/)
            .slice(0, 3)
            .map((n) => Number(n) || 0);
    const nueva = numeros(tag);
    const instalada = numeros(actual);
    for (let i = 0; i < 3; i++) if (nueva[i] !== instalada[i]) return nueva[i] > instalada[i];
    return false;
};

(async () => {
    const plugins = globalThis.Capacitor?.Plugins;
    if (!plugins?.App?.getInfo) return; // solo Android tiene versión nativa
    try {
        const hoy = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem(CLAVE_DIA) === hoy) return;
        localStorage.setItem(CLAVE_DIA, hoy); // un intento por día, también si falla

        const info = await plugins.App.getInfo();
        const release = await leerJsonExterna(URL_RELEASES);
        const apk = release.assets?.find((a) => a.name?.endsWith(".apk"));
        if (!release.tag_name || !apk || !esMayor(release.tag_name, info.version)) return;

        const caja = h("aside", { class: "aviso-version", role: "status", "aria-label": "Actualización disponible" });
        const instalar = h("button", { class: "btn", type: "button" }, "Descargar e instalar");
        instalar.addEventListener("click", async () => {
            if (!plugins.InstaladorApk?.descargar) return; // el enlace de abajo sigue funcionando
            try {
                instalar.disabled = true;
                const sha256 = apk.digest?.replace(/^sha256:/, "").toLowerCase();
                if (!sha256) throw new Error("La release no publica la huella del APK");
                const descargado = await plugins.InstaladorApk.descargar({
                    url: apk.browser_download_url,
                    sha256,
                });
                await plugins.InstaladorApk.instalar({ uri: descargado.uri });
            } catch (e) {
                caja.querySelector(".aviso-version-error")?.remove();
                caja.append(
                    h("p", { class: "aviso-version-error", text: `${msgError(e)}. Usa «Abrir en el navegador».` }),
                );
                instalar.disabled = false;
            }
        });

        caja.append(
            h("strong", { text: `Versión nueva: ${release.tag_name}` }),
            h("p", { class: "notas", text: (release.body ?? "").slice(0, 600) }),
            h("p", { class: "hint", text: "Android pedirá permiso de «orígenes desconocidos» la primera vez." }),
            h(
                "div",
                { class: "row" },
                instalar,
                h(
                    "a",
                    { class: "btn small", href: apk.browser_download_url, target: "_blank", rel: "noopener" },
                    "Abrir en el navegador",
                ),
                h(
                    "button",
                    {
                        class: "btn small",
                        type: "button",
                        "aria-label": "Cerrar aviso de actualización",
                        onclick: () => caja.remove(),
                    },
                    "Ahora no",
                ),
            ),
        );
        document.body.prepend(caja);
    } catch {
        /* Sin red, GitHub caído o respuesta inesperada: la app sigue igual. */
    }
})();
