import { Sesion } from "./repaso.js";
import { api, barajar, h, LETRAS, msgError } from "./comun.js";
import { etiquetaTema } from "./etiquetas.js";

/* Test infinito (cliente): UI del test. El planificador vive en ./repaso.js.
   Los datos viven en el servidor (SQLite): preguntas por /api/test y progreso por /api/progreso. */
(() => {
    "use strict";

    /* ---------- Parámetros de la UI ---------- */
    const PAUSA_ACIERTO_MS = 450; // pausa tras un acierto antes de pasar a la siguiente
    const ETIQUETA = "Guardado en la base de datos";

    /* ---------- Utilidades ---------- */
    const $ = (s) => document.querySelector(s);

    /* ---------- Estado ---------- */
    let bank = []; // preguntas de la sesión: {i,t,p,o,c,e}
    let progress = {}; // id -> [caja, vence, aciertos, fallos]
    let seleccion = new Set();
    let pantalla = "setup";
    let sesion = null;
    let cur = null; // pregunta en pantalla
    let timerAcierto = null;
    let sucios = new Set();
    let timerGuardado = null;
    let carga = null; // cupo diario que devuelve el servidor
    let examenInfo = null; // fecha de examen y tope de intervalo (Fase 3.6)
    let respuestasCola = []; // respuestas pendientes de enviar a /api/respuestas
    let timerRespuestas = null;
    let unaPulsacion = false; // responder al primer toque (móvil)
    let selAntesPuntero = null; // opción marcada antes del puntero, para distinguir el primer toque
    const CLAVE_UN_TOQUE = "ti.una-pulsacion";

    function setStatus(kind, text) {
        const s = $("#status");
        s.dataset.state = kind;
        s.title = text;
        const visible = s.querySelector(".status-text");
        if (visible) visible.textContent = text;
    }
    function nota(texto, lineas) {
        const n = $("#note");
        if (!texto) {
            n.hidden = true;
            n.replaceChildren();
            return;
        }
        const partes = [h("span", { text: texto })];
        if (lineas && lineas.length)
            partes.push(
                h(
                    "ul",
                    null,
                    lineas.map((l) => h("li", { text: l })),
                ),
            );
        n.replaceChildren(...partes);
        n.hidden = false;
    }

    /* ---------- Progreso: guardado diferido por lotes ---------- */
    function marcarSucio(id) {
        sucios.add(id);
        clearTimeout(timerGuardado);
        timerGuardado = setTimeout(guardarProgreso, 700);
    }
    async function guardarProgreso() {
        clearTimeout(timerGuardado);
        if (!sucios.size) return;
        const ids = [...sucios];
        sucios.clear();
        setStatus("busy", "Guardando…");
        try {
            await api("/api/progreso", {
                metodo: "POST",
                keepalive: true,
                cuerpo: ids.map((id) => {
                    const p = progress[id];
                    return { id, caja: p[0], vence: p[1], aciertos: p[2], fallos: p[3] };
                }),
            });
            setStatus("ok", ETIQUETA);
        } catch (e) {
            ids.forEach((id) => sucios.add(id));
            setStatus("warn", "No se pudo guardar: " + msgError(e));
        }
    }
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            guardarProgreso();
            guardarRespuestas();
        }
    });
    window.addEventListener("pagehide", () => {
        guardarProgreso();
        guardarRespuestas();
    });

    /* ---------- Respuestas: un evento por pregunta, para las estadísticas y el cupo diario ---------- */
    function encolarRespuesta(id, acierto, ms) {
        respuestasCola.push({ id, acierto, ms });
        clearTimeout(timerRespuestas);
        timerRespuestas = setTimeout(guardarRespuestas, 700);
    }
    async function guardarRespuestas() {
        clearTimeout(timerRespuestas);
        if (!respuestasCola.length) return;
        const lote = respuestasCola;
        respuestasCola = [];
        try {
            await api("/api/respuestas", {
                metodo: "POST",
                keepalive: true,
                cuerpo: { respuestas: lote },
            });
        } catch (e) {
            respuestasCola = lote.concat(respuestasCola);
            setStatus("warn", "No se pudieron guardar las respuestas: " + msgError(e));
        }
    }

    /* ---------- Cupo diario (lo calcula el servidor; aquí solo se muestra) ---------- */
    function leerCarga() {
        const el = document.querySelector("#grid .carga");
        if (!el) {
            return;
        }
        carga = {
            nuevasHoy: Number(el.dataset.nuevasHoy || 0),
            cupoNuevas: Number(el.dataset.cupoNuevas || 0),
            repasosPendientes: Number(el.dataset.repasos || 0),
            repasosAtrasados: Number(el.dataset.atrasados || 0),
            bloqueadoPorAtraso: el.dataset.bloqueado === "1",
        };
    }
    function pintarCarga() {
        const el = $("#cupo");
        if (!el) return;
        if (!carga) {
            el.textContent = "";
            return;
        }
        const restantes = Math.max(0, carga.cupoNuevas - carga.nuevasHoy);
        const partes = ["Nuevas hoy: " + carga.nuevasHoy + "/" + carga.cupoNuevas];
        if (carga.repasosPendientes) partes.push(carga.repasosPendientes + " por repasar");
        if (carga.bloqueadoPorAtraso) partes.push("frenado: " + carga.repasosAtrasados + " repasos atrasados");
        else if (restantes === 0) partes.push("cupo de nuevas agotado hoy");
        el.textContent = partes.join(" · ");
        const repasos = $("#hoy-repasos");
        const nuevas = $("#hoy-nuevas");
        const barra = $("#hoy-barra");
        if (repasos) repasos.textContent = String(carga.repasosPendientes);
        if (nuevas) nuevas.textContent = String(Math.min(carga.nuevasHoy, carga.cupoNuevas));
        if (barra) barra.style.width = Math.min(100, (carga.nuevasHoy / carga.cupoNuevas) * 100) + "%";
        const aviso = $("#hoy-aviso");
        if (aviso) aviso.hidden = !carga.bloqueadoPorAtraso;
    }
    /** Nuevas que aún se pueden introducir en esta sesión, según el cupo del servidor. */
    function nuevasPermitidas() {
        if (!carga) return Infinity;
        if (carga.bloqueadoPorAtraso) return 0;
        return Math.max(0, carga.cupoNuevas - carga.nuevasHoy);
    }

    /* ---------- Pantalla de preparación (la rejilla llega ya pintada desde el servidor) ---------- */
    const chips = () => [...document.querySelectorAll("#grid .chip")];
    function guardarSeleccion() {
        try {
            localStorage.setItem("ti.sel", JSON.stringify([...seleccion]));
        } catch (e) {}
    }
    function leerSeleccion() {
        try {
            const v = JSON.parse(localStorage.getItem("ti.sel"));
            return Array.isArray(v) ? v : null;
        } catch (e) {
            return null;
        }
    }

    /* Responder al primer toque: activado por defecto en pantallas táctiles si no hay preferencia guardada. */
    function leerUnaPulsacion() {
        try {
            const v = localStorage.getItem(CLAVE_UN_TOQUE);
            unaPulsacion =
                v === null ? !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches) : v === "1";
        } catch (e) {
            unaPulsacion = false;
        }
        const el = $("#cfg-un-toque");
        if (el) el.checked = unaPulsacion;
    }
    $("#cfg-un-toque")?.addEventListener("change", (e) => {
        unaPulsacion = e.target.checked;
        try {
            localStorage.setItem(CLAVE_UN_TOQUE, unaPulsacion ? "1" : "0");
        } catch (err) {}
    });

    /* Distingue puntero de teclado para que «primer toque» no dispare al navegar con flechas. */
    document.addEventListener(
        "pointerdown",
        () => {
            selAntesPuntero = null;
        },
        true,
    );

    /* Refleja `seleccion` en las fichas y actualiza el resumen. Si no queda ningún tema válido, marca todos. */
    function sincronizarSeleccion(previa) {
        const existentes = new Set(chips().map((c) => Number(c.dataset.tema)));
        seleccion = new Set([...(previa || seleccion)].filter((t) => existentes.has(t)));
        if (!seleccion.size) seleccion = new Set(existentes);
        chips().forEach((c) => c.setAttribute("aria-checked", String(seleccion.has(Number(c.dataset.tema)))));
        actualizarResumen();
    }
    function fijarSeleccion(todos) {
        seleccion = todos ? new Set(chips().map((c) => Number(c.dataset.tema))) : new Set();
        chips().forEach((c) => c.setAttribute("aria-checked", String(todos)));
        actualizarResumen();
        guardarSeleccion();
    }
    function actualizarResumen() {
        let total = 0,
            nuevas = 0,
            repaso = 0;
        for (const c of chips())
            if (seleccion.has(Number(c.dataset.tema))) {
                total += Number(c.dataset.total);
                nuevas += Number(c.dataset.nuevas);
                repaso += Number(c.dataset.repaso);
            }
        const sum = $("#sum");
        sum.replaceChildren();
        if (!seleccion.size) {
            sum.textContent = "Marca al menos un tema para empezar.";
        } else
            sum.append(
                h("b", { text: String(total) }),
                " preguntas · ",
                h("b", { text: String(repaso) }),
                " por repasar hoy · ",
                h("b", { text: String(nuevas) }),
                " nuevas",
            );
        $("#btn-start").disabled = !seleccion.size;
        document.querySelectorAll("#grid .bloque").forEach((b) => {
            const cs = [...b.querySelectorAll(".chip")];
            const n = cs.filter((c) => seleccion.has(Number(c.dataset.tema))).length;
            const cuenta = b.querySelector(".bloque-sel-count");
            if (cuenta) cuenta.textContent = n + " de " + cs.length;
        });
    }

    /* Filtra la rejilla por número o nombre de tema. No altera la selección. */
    function filtrarTemas() {
        const input = $("#buscar-temas");
        const q = (input?.value ?? "").trim().toLowerCase();
        let visibles = 0;
        document.querySelectorAll("#grid .bloque").forEach((b) => {
            let alguno = false;
            for (const c of b.querySelectorAll(".chip")) {
                const texto = (c.textContent + " " + (c.title || "")).toLowerCase();
                const coincide = !q || texto.includes(q);
                c.hidden = !coincide;
                if (coincide) alguno = true;
            }
            b.hidden = !alguno;
            if (alguno) visibles++;
        });
        const vacio = $("#sin-resultados");
        if (vacio) vacio.hidden = visibles > 0 || !q;
    }
    /* Pide al servidor la rejilla actualizada (estadísticas tras una sesión o un reinicio). */
    async function refrescarTemas() {
        try {
            $("#grid").innerHTML = await (await api("/fragmentos/temas", { bruto: true })).text();
            leerCarga();
            sincronizarSeleccion();
            pintarCarga();
            filtrarTemas();
        } catch (e) {
            setStatus("warn", "No se pudieron actualizar los temas: " + msgError(e));
        }
    }

    $("#grid").addEventListener("mousedown", (e) => {
        if (e.target.closest(".chip")) e.preventDefault();
    });
    $("#grid").addEventListener("click", (e) => {
        const c = e.target.closest(".chip");
        if (!c) return;
        const t = Number(c.dataset.tema);
        if (seleccion.has(t)) seleccion.delete(t);
        else seleccion.add(t);
        c.setAttribute("aria-checked", String(seleccion.has(t)));
        actualizarResumen();
        guardarSeleccion();
    });
    /* Selecciona (o deselecciona) todos los temas de un bloque. */
    $("#grid").addEventListener("click", (e) => {
        const b = e.target.closest(".sel-bloque");
        if (!b) return;
        const cs = [...b.closest(".bloque").querySelectorAll(".chip")];
        const temas = cs.map((c) => Number(c.dataset.tema));
        const todos = temas.every((t) => seleccion.has(t));
        for (const t of temas) {
            if (todos) seleccion.delete(t);
            else seleccion.add(t);
        }
        cs.forEach((c) => c.setAttribute("aria-checked", String(seleccion.has(Number(c.dataset.tema)))));
        actualizarResumen();
        guardarSeleccion();
    });

    /* ---------- Borrados con doble pulsación ---------- */
    function conConfirmacion(btn, texto, accion) {
        const original = btn.textContent;
        let t = null;
        btn.addEventListener("click", async () => {
            if (!btn.classList.contains("armed")) {
                btn.classList.add("armed");
                btn.textContent = "¿Seguro? Pulsa otra vez";
                t = setTimeout(() => {
                    btn.classList.remove("armed");
                    btn.textContent = original;
                }, 4000);
                return;
            }
            clearTimeout(t);
            btn.classList.remove("armed");
            btn.textContent = original;
            try {
                await accion();
                nota(texto);
            } catch (e) {
                setStatus("warn", "No se pudo completar: " + msgError(e));
            }
        });
    }
    conConfirmacion(
        $("#btn-clear-prog"),
        "Progreso reiniciado: todas las preguntas vuelven a ser nuevas.",
        async () => {
            clearTimeout(timerGuardado);
            sucios.clear();
            clearTimeout(timerRespuestas);
            respuestasCola = [];
            await api("/api/progreso", { metodo: "DELETE" });
            progress = {};
            await refrescarTemas();
        },
    );
    $("#btn-all").addEventListener("click", () => fijarSeleccion(true));
    $("#btn-none").addEventListener("click", () => fijarSeleccion(false));
    $("#btn-start").addEventListener("click", empezar);
    $("#buscar-temas")?.addEventListener("input", filtrarTemas);

    /* ---------- Fecha de examen (Fase 3.6): acorta los intervalos de repaso ---------- */
    function pintarExamen() {
        const el = $("#examen-info");
        if (!el) return;
        const ex = examenInfo;
        if (!ex || !ex.fecha) {
            el.textContent = "";
            return;
        }
        el.textContent =
            ex.dias > 0
                ? `${ex.dias} día${ex.dias === 1 ? "" : "s"} hasta el examen · los repasos se acortan a ${ex.topeDias} día${ex.topeDias === 1 ? "" : "s"}`
                : "La fecha de examen ya ha pasado.";
    }
    async function guardarExamen() {
        const input = $("#cfg-examen");
        if (!input) return;
        setStatus("busy", "Guardando...");
        try {
            const d = await api("/api/ajustes", { metodo: "PUT", cuerpo: { fecha_examen: input.value || null } });
            examenInfo = d.examen;
            pintarExamen();
            setStatus("ok", ETIQUETA);
        } catch (e) {
            setStatus("warn", "No se pudo guardar la fecha: " + msgError(e));
        }
    }
    $("#cfg-examen")?.addEventListener("change", guardarExamen);

    /* ---------- Test ---------- */
    const ICO_OK =
        '<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 11.5l4.5 4.5 8.5-9.5"/></svg>';
    const ICO_BAD =
        '<svg viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5.5 5.5l11 11M16.5 5.5l-11 11"/></svg>';

    async function empezar() {
        if (!seleccion.size || pantalla !== "setup") return;
        const boton = $("#btn-start");
        boton.disabled = true;
        setStatus("busy", "Cargando preguntas…");
        try {
            await guardarProgreso();
            await guardarRespuestas();
            const d = await api("/api/test?temas=" + [...seleccion].sort((a, b) => a - b).join(","));
            bank = d.preguntas.map((q) => ({
                i: q.id,
                t: q.tema,
                tn: q.tema_numero ?? q.tema,
                bn: q.bloque_nombre ?? "",
                nb: q.tema_nombre ?? "",
                p: q.pregunta,
                o: q.respuestas,
                c: q.correcta,
                e: q.explicacion,
            }));
            progress = d.progreso;
            if (d.carga) carga = d.carga;
            if (d.examen) {
                examenInfo = d.examen;
                pintarExamen();
            }
            if (!bank.length) throw new Error("Los temas elegidos no tienen preguntas.");
        } catch (e) {
            setStatus("warn", "No se pudieron cargar las preguntas: " + msgError(e));
            boton.disabled = false;
            return;
        }
        setStatus("ok", ETIQUETA);
        boton.disabled = false;
        nota(null);
        pintarCarga();
        sesion = new Sesion(bank, {
            progreso: progress,
            alCambiar: marcarSucio,
            nuevasPermitidas: nuevasPermitidas(),
            topeIntervalo: examenInfo?.topeDias ?? 0,
        });
        pantalla = "quiz";
        $("#screen-setup").hidden = true;
        $("#screen-quiz").hidden = false;
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        preguntar();
    }
    function preguntar() {
        clearTimeout(timerAcierto);
        const [q, tipo] = sesion.siguiente();
        const orden = barajar(q.o.map((_, k) => k));
        cur = { q, tipo, orden, sel: 0, corr: orden.indexOf(q.c), fase: "elegir", t0: Date.now() };
        $("#q-tema").textContent = etiquetaTema({ tema: q.t, tema_numero: q.tn, bloque_nombre: q.bn, nombre: q.nb });
        const kind = $("#q-kind");
        kind.textContent = tipo;
        kind.dataset.kind = tipo;
        $("#q-text").textContent = q.p;
        $("#q-opts").replaceChildren(
            ...orden.map((oi, k) =>
                h(
                    "label",
                    { class: "opt", "data-k": String(k) },
                    h("input", {
                        type: "radio",
                        name: "opcion",
                        value: String(k),
                        "aria-label": "Opción " + LETRAS[k],
                        onchange: () => {
                            if (cur && cur.fase === "elegir") {
                                cur.sel = k;
                                pintarSeleccion();
                            }
                        },
                    }),
                    h("span", { class: "bubble", text: LETRAS[k] }),
                    h("span", { class: "otext", text: q.o[oi] }),
                    h("span", { class: "mark", "aria-hidden": "true" }),
                ),
            ),
        );
        pintarAyudaTeclas(orden.length);
        $("#q-fb").hidden = true;
        const correcta = $("#q-correcta");
        if (correcta) correcta.hidden = true;
        pintarSeleccion();
        pintarMarcador();
        botonPrincipal();
        enfocarOpcion(0);
        window.scrollTo(0, 0);
    }
    function opciones() {
        return [...document.querySelectorAll("#q-opts .opt")];
    }
    function enfocarOpcion(k) {
        opciones()[k]?.querySelector("input")?.focus({ preventScroll: true });
    }
    function pintarAyudaTeclas(n) {
        const el = $("#keys-opts");
        if (!el) return;
        if (n < 1) {
            el.textContent = "";
            return;
        }
        el.replaceChildren(
            h("kbd", { text: "A" }),
            "–",
            h("kbd", { text: LETRAS[n - 1] }),
            " o ",
            h("kbd", { text: "1" }),
            "–",
            h("kbd", { text: String(n) }),
            " saltar a una opción",
        );
    }
    function pintarSeleccion() {
        opciones().forEach((o, k) => {
            const inp = o.querySelector("input");
            if (inp) inp.checked = k === cur.sel && cur.fase === "elegir";
        });
    }
    function pintarMarcador() {
        const pct = sesion.n ? Math.round((100 * sesion.aciertos) / sesion.n) : 0;
        $("#q-score").textContent = sesion.n + " respondidas · " + pct + " % de aciertos";
        const { rep, nue } = sesion.pendientes();
        $("#q-left").textContent = "por repasar " + rep + " · nuevas " + nue;
        const barra = $("#q-progress");
        if (barra) barra.style.width = pct + "%";
    }
    function botonPrincipal() {
        const b = $("#btn-main");
        b.replaceChildren(cur.fase === "elegir" ? "Confirmar " : "Continuar ", h("kbd", { text: "Enter" }));
    }
    function mover(d) {
        const n = cur.orden.length;
        cur.sel = (cur.sel + d + n) % n;
        pintarSeleccion();
        enfocarOpcion(cur.sel);
    }
    function seleccionar(k) {
        cur.sel = k;
        pintarSeleccion();
        enfocarOpcion(k);
    }

    /* Con puntero, el primer clic selecciona (o confirma si ya estaba marcada) y con «primer toque» confirma siempre.
   Con teclado, el cambio nativo del radio solo mueve la selección; Enter confirma. */
    $("#q-opts").addEventListener("pointerdown", (e) => {
        if (!cur || cur.fase !== "elegir") return;
        const opt = e.target.closest(".opt");
        if (opt) selAntesPuntero = cur.sel;
    });
    $("#q-opts").addEventListener("click", (e) => {
        if (!cur || cur.fase !== "elegir") return;
        const opt = e.target.closest(".opt");
        if (!opt || e.detail === 0) return; // teclado o lector de pantalla: comportamiento nativo
        e.preventDefault();
        const k = Number(opt.dataset.k);
        const yaEstaba = selAntesPuntero === k;
        seleccionar(k);
        if (unaPulsacion || yaEstaba) confirmar();
    });

    function confirmar() {
        if (!cur || cur.fase !== "elegir") return;
        const ok = cur.sel === cur.corr;
        sesion.registrar(cur.q, ok);
        encolarRespuesta(cur.q.i, ok, Math.max(0, Date.now() - cur.t0));
        const ops = opciones();
        ops.forEach((o) => {
            const inp = o.querySelector("input");
            if (inp) {
                inp.disabled = true;
                inp.checked = false;
            }
        });
        ops[cur.corr].classList.add("ok");
        ops[cur.corr].querySelector(".mark").innerHTML = ICO_OK;
        const letra = LETRAS[cur.corr];
        if (ok) {
            cur.fase = "acierto";
            $("#sr").textContent = "Correcto.";
            timerAcierto = setTimeout(preguntar, PAUSA_ACIERTO_MS);
        } else {
            cur.fase = "revision";
            ops[cur.sel].classList.add("bad");
            ops[cur.sel].querySelector(".mark").innerHTML = ICO_BAD;
            ops.forEach((o, k) => {
                if (k !== cur.sel && k !== cur.corr) o.classList.add("dim");
            });
            $("#q-verdict").textContent = "Incorrecta";
            const correcta = $("#q-correcta");
            correcta.replaceChildren(
                document.createTextNode("Respuesta correcta: "),
                h("b", { text: letra + ") " + cur.q.o[cur.orden[cur.corr]] }),
            );
            correcta.hidden = false;
            const ex = $("#q-expl");
            ex.textContent = cur.q.e;
            ex.hidden = !cur.q.e;
            $("#q-fb").hidden = false;
            $("#sr").textContent = "Incorrecta. La respuesta correcta es la " + letra + ". " + cur.q.e;
            $("#q-fb").scrollIntoView({ block: "nearest" });
        }
        pintarMarcador();
        botonPrincipal();
    }
    function avanzar() {
        if (cur && cur.fase !== "elegir") preguntar();
    }
    $("#btn-main").addEventListener("click", () => {
        if (cur.fase === "elegir") confirmar();
        else avanzar();
    });
    $("#btn-exit").addEventListener("click", salir);

    async function salir() {
        if (pantalla !== "quiz") return;
        clearTimeout(timerAcierto);
        const { aciertos, n } = sesion;
        pantalla = "setup";
        cur = null;
        $("#screen-quiz").hidden = true;
        $("#screen-setup").hidden = false;
        nota(
            n
                ? "Sesión terminada: " +
                      aciertos +
                      " de " +
                      n +
                      " acertadas (" +
                      Math.round((100 * aciertos) / n) +
                      " %)."
                : null,
        );
        window.scrollTo(0, 0);
        await guardarProgreso();
        await guardarRespuestas();
        await refrescarTemas();
    }

    document.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
        if (pantalla === "quiz" && cur) {
            const k = e.key;
            if (k === "Escape") {
                e.preventDefault();
                salir();
                return;
            }
            if (k === "Enter") {
                e.preventDefault();
                if (e.repeat) return;
                if (cur.fase === "elegir") confirmar();
                else avanzar();
                return;
            }
            if (cur.fase !== "elegir") return;
            if (k === "ArrowDown" || k === "ArrowUp") {
                e.preventDefault();
                mover(k === "ArrowDown" ? 1 : -1);
                return;
            }
            let n = -1;
            if (/^[1-9]$/.test(k)) n = Number(k) - 1;
            else if (/^[a-hA-H]$/.test(k)) n = k.toLowerCase().charCodeAt(0) - 97;
            if (n >= 0 && n < cur.orden.length) {
                e.preventDefault();
                seleccionar(n);
            }
            return;
        }
        if (
            pantalla === "setup" &&
            e.key === "Enter" &&
            !e.repeat &&
            (e.target === document.body || e.target === document.documentElement || e.target === document)
        ) {
            if (!$("#ready").hidden && !$("#btn-start").disabled) {
                e.preventDefault();
                empezar();
            }
        }
    });

    /* ---------- Arranque ---------- */
    leerUnaPulsacion();
    sincronizarSeleccion(leerSeleccion() || []);
    filtrarTemas();
    leerCarga();
    pintarCarga();
    setStatus("ok", ETIQUETA);
})();
