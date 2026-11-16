/* Conmutador de tema claro/oscuro. La elección se guarda en localStorage
   y el script del <head> la aplica antes de pintar para evitar parpadeos. */
(() => {
    /* F3.3: nombre del banco activo (lo inyecta el servidor en modo biblioteca) junto a la
       marca, enlazando a la Biblioteca. Sin inyección (modo directo) el enlace queda oculto. */
    const bancoActual = document.getElementById("banco-actual");
    if (bancoActual && globalThis.__opiosBancoNombre) {
        bancoActual.textContent = globalThis.__opiosBancoNombre;
        bancoActual.hidden = false;
    }

    const CLAVE = "opios.tema";
    const raiz = document.documentElement;
    const boton = document.getElementById("btn-tema");
    if (!boton) return;

    const guardado = () => {
        try {
            const v = localStorage.getItem(CLAVE);
            return v === "light" || v === "dark" ? v : null;
        } catch (e) {
            return null;
        }
    };
    const prefiereOscuro = () => window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const temaActual = () => raiz.dataset.theme || (prefiereOscuro() ? "dark" : "light");

    /* Android: la barra de estado sigue al tema (6.5). Los plugins oficiales ya están en
       `Capacitor.Plugins`, así que el script no necesita importar nada. */
    const pintarBarra = (oscuro) => {
        const barra = globalThis.Capacitor?.Plugins?.StatusBar;
        if (!barra) return;
        barra.setStyle({ style: oscuro ? "LIGHT" : "DARK" }).catch(() => {});
        barra.setBackgroundColor({ color: oscuro ? "#0B0B0C" : "#FAFAFA" }).catch(() => {});
    };

    function pintar() {
        const oscuro = temaActual() === "dark";
        pintarBarra(oscuro);
        const icono = document.getElementById("tema-icono");
        const texto = document.getElementById("tema-texto");
        const destino = oscuro ? "claro" : "oscuro";
        if (icono) icono.textContent = oscuro ? "☀" : "☾";
        if (texto) texto.textContent = oscuro ? "Claro" : "Oscuro";
        boton.setAttribute("aria-label", "Cambiar a tema " + destino);
        boton.setAttribute("title", "Cambiar a tema " + destino);
        boton.setAttribute("aria-pressed", String(oscuro));
    }

    boton.addEventListener("click", () => {
        const nuevo = temaActual() === "dark" ? "light" : "dark";
        raiz.dataset.theme = nuevo;
        try {
            localStorage.setItem(CLAVE, nuevo);
        } catch (e) {}
        pintar();
    });

    if (window.matchMedia) {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const alCambiar = () => {
            if (!guardado()) pintar();
        };
        if (mq.addEventListener) mq.addEventListener("change", alCambiar);
        else if (mq.addListener) mq.addListener(alCambiar);
    }

    pintar();
})();
