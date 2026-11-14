import * as cliente from "./cliente.js";
import { h, LETRAS, MAX_OPC, MIN_OPC, msgError as msg } from "./comun.js";
import { etiquetaTema } from "./etiquetas.js";

/* Creador de preguntas (cliente): edita directamente la base de datos a través de /api/preguntas. */
(() => {
    "use strict";

    const OPC_INICIALES = 4,
        PAGINA = 50,
        MAX_ETIQUETA = 60;
    const $ = (s) => document.querySelector(s);

    /* ---------- Estado ---------- */
    let items = []; // página(s) cargadas: { id, tema, pregunta, respuestas[], correcta, explicacion }
    let total = 0; // total de preguntas que cumplen el filtro
    let draft = nuevoBorrador("");
    let editando = null; // id de la pregunta que se edita, o null
    let envio = 0; // descarta respuestas de listados antiguos
    let temario = []; // bloques con sus temas, tal y como llega de /api/temario
    let etiquetas = new Map(); // id de tema -> { bloque, numero, nombre }

    function nuevoBorrador(tema) {
        return { tema, pregunta: "", opciones: Array(OPC_INICIALES).fill(""), c: 0, expl: "" };
    }
    /* Recorta las etiquetas largas para que los desplegables no se alarguen de más. */
    const recortar = (s, max = MAX_ETIQUETA) => (s.length > max ? s.slice(0, max - 3).trimEnd() + "..." : s);
    const textoOpcion = (t) => etiquetaTema(t, { bloque: false });

    /* ---------- Mensajes ---------- */
    let tFlash = null;
    function flash(texto, tipo) {
        const f = $("#flash");
        f.textContent = texto;
        f.dataset.tipo = tipo || "";
        clearTimeout(tFlash);
        tFlash = setTimeout(() => {
            f.textContent = "";
        }, 4000);
    }
    function mostrarError(texto, accion) {
        const e = $("#f-error");
        const partes = [h("span", { text: texto })];
        if (accion)
            partes.push(h("button", { class: "btn small", type: "button", onclick: accion.fn, text: accion.texto }));
        e.replaceChildren(...partes);
        e.hidden = false;
    }
    function ocultarError() {
        $("#f-error").hidden = true;
    }
    function setStatus(kind, text) {
        const s = $("#status");
        s.dataset.state = kind;
        s.title = text;
        const visible = s.querySelector(".status-text");
        if (visible) visible.textContent = text;
    }

    /* ---------- Estado de guardado ---------- */
    function marcarSucio() {
        const s = $("#save-state");
        if (s) {
            s.textContent = "Sin guardar";
            s.dataset.state = "dirty";
        }
    }
    function marcarGuardado() {
        const s = $("#save-state");
        if (s) {
            s.textContent = "Guardado";
            s.dataset.state = "ok";
        }
    }

    /* ---------- Editor ---------- */
    function pintarEditor() {
        const sel = $("#f-tema"),
            valor = String(draft.tema ?? "");
        if ([...sel.options].some((o) => o.value === valor)) sel.value = valor;
        else if (sel.options.length) {
            sel.selectedIndex = 0;
            draft.tema = sel.value;
        } else draft.tema = "";
        $("#f-preg").value = draft.pregunta;
        $("#f-expl").value = draft.expl;
        pintarOpciones();
        const ed = editando !== null;
        $("#ed-title").textContent = ed ? "Editar pregunta" : "Nueva pregunta";
        $("#ed-mode").textContent = ed ? "Editando la nº " + editando : "";
        $("#btn-save").replaceChildren(ed ? "Guardar cambios " : "Añadir pregunta ", h("kbd", { text: "Ctrl+Enter" }));
        $("#btn-cancel").hidden = !ed;
        ocultarError();
    }
    function pintarOpciones() {
        const cont = $("#f-opts");
        cont.replaceChildren(
            ...draft.opciones.map((t, k) =>
                h(
                    "div",
                    { class: "orow" },
                    h("button", {
                        type: "button",
                        class: "bub" + (draft.c === k ? " on" : ""),
                        tabindex: "-1",
                        "aria-label": "Marcar la opción " + LETRAS[k] + " como correcta",
                        onclick: () => marcarCorrecta(k),
                        text: LETRAS[k],
                    }),
                    h("input", {
                        type: "text",
                        id: "o-" + k,
                        value: t,
                        "aria-label": "Opción " + LETRAS[k],
                        autocomplete: "off",
                        oninput: (e) => {
                            draft.opciones[k] = e.target.value;
                            marcarSucio();
                        },
                        onkeydown: (e) => {
                            if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
                            e.preventDefault();
                            const sig = $("#o-" + (k + 1));
                            if (sig) sig.focus();
                            else {
                                const r = $("#f-correct input:checked") || $("#f-correct input");
                                if (r) r.focus();
                            }
                        },
                    }),
                    h("button", {
                        type: "button",
                        class: "x",
                        tabindex: "-1",
                        "aria-label": "Quitar la opción " + LETRAS[k],
                        onclick: () => quitarOpcion(k),
                        text: "×",
                    }),
                ),
            ),
        );
        const g = $("#f-correct");
        g.replaceChildren(
            ...draft.opciones.map((_, k) => {
                const inp = h("input", { type: "radio", name: "correcta", id: "c-" + k, value: String(k) });
                inp.checked = draft.c === k;
                inp.addEventListener("change", () => marcarCorrecta(k, true));
                return h("span", { class: "pill" }, inp, h("label", { for: "c-" + k, text: LETRAS[k] }));
            }),
        );
        $("#btn-add-opt").disabled = draft.opciones.length >= MAX_OPC;
    }
    function marcarCorrecta(k, desdeRadio) {
        draft.c = k;
        document.querySelectorAll("#f-opts .bub").forEach((b, i) => b.classList.toggle("on", i === k));
        if (!desdeRadio)
            document.querySelectorAll("#f-correct input").forEach((r, i) => {
                r.checked = i === k;
            });
        marcarSucio();
    }
    function anadirOpcion() {
        if (draft.opciones.length >= MAX_OPC) return;
        draft.opciones.push("");
        pintarOpciones();
        $("#o-" + (draft.opciones.length - 1)).focus();
    }
    function quitarOpcion(k) {
        if (draft.opciones.length <= MIN_OPC) {
            flash("Hacen falta al menos 2 opciones.", "warn");
            return;
        }
        draft.opciones.splice(k, 1);
        if (draft.c === k) draft.c = 0;
        else if (draft.c > k) draft.c--;
        pintarOpciones();
    }

    /* ---------- Validar y guardar una pregunta ---------- */
    function validarBorrador() {
        const sel = $("#f-tema");
        const tema = Number(sel.value);
        if (!sel.value || !Number.isInteger(tema) || tema < 0)
            return { msg: "Elige un tema. Si todavía no existe, créalo en Organizar temario.", foco: "#f-tema" };
        draft.tema = String(tema);
        const pregunta = draft.pregunta.trim();
        if (!pregunta) return { msg: "Escribe la pregunta.", foco: "#f-preg" };
        const llenas = [];
        draft.opciones.forEach((t, k) => {
            if (t.trim()) llenas.push(k);
        });
        if (llenas.length < MIN_OPC) {
            const vacia = draft.opciones.findIndex((t) => !t.trim());
            return { msg: "Escribe al menos dos opciones.", foco: "#o-" + Math.max(0, vacia) };
        }
        if (!llenas.includes(draft.c))
            return {
                msg: "La respuesta correcta (" + LETRAS[draft.c] + ") es una opción vacía. Elige otra o rellénala.",
                foco: "#f-correct input:checked",
            };
        const respuestas = llenas.map((k) => draft.opciones[k].trim());
        const vistas = new Set();
        for (const r of respuestas) {
            const kk = r.toLowerCase();
            if (vistas.has(kk))
                return { msg: "Hay dos opciones iguales: «" + r + "».", foco: "#o-" + llenas[respuestas.indexOf(r)] };
            vistas.add(kk);
        }
        return { q: { tema, pregunta, respuestas, correcta: llenas.indexOf(draft.c), explicacion: draft.expl.trim() } };
    }
    function cuerpoDe(q) {
        return {
            tema: q.tema,
            pregunta: q.pregunta,
            respuestas: q.respuestas,
            correcta: q.correcta,
            explicacion: q.explicacion,
        };
    }

    /** Diálogo para reemplazar una pregunta duplicada, con el mismo estilo que el resto. */
    function preguntarDuplicado(mensaje) {
        const dlg = $("#dlg-duplicado");
        if (!dlg) return Promise.resolve(false);
        $("#dup-msg").textContent = mensaje;
        $("#dup-reemplazar").className = "btn danger";
        $("#dup-reemplazar").textContent = "Reemplazarla";
        return new Promise((resolve) => {
            dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
            dlg.returnValue = "cancel";
            dlg.showModal();
        });
    }

    async function guardarPregunta() {
        const r = validarBorrador();
        if (r.msg) {
            mostrarError(r.msg);
            const f = $(r.foco);
            if (f) f.focus();
            return;
        }
        try {
            await persistir(r.q, editando);
        } catch (e) {
            if (e.status === 409 && e.datos.existente) {
                const ex = e.datos.existente;
                const reemplazar = await preguntarDuplicado(e.message);
                if (reemplazar) await persistir(r.q, ex.id, true).catch((e2) => mostrarError(msg(e2)));
            } else mostrarError(msg(e));
        }
    }
    /* Crea (id null) o actualiza una pregunta. Con `reemplazo`, la pregunta que se estaba editando se borra (queda fusionada). */
    async function persistir(q, id, reemplazo) {
        const edicion = id !== null;
        setStatus("busy", "Guardando…");
        try {
            await (edicion
                ? cliente.preguntaGuardar(cuerpoDe(q), id)
                : cliente.preguntaGuardar(cuerpoDe(q)));
            if (reemplazo && editando !== null && editando !== id)
                await cliente.preguntaBorrar(editando);
        } catch (e) {
            setStatus("warn", "No se pudo guardar");
            throw e;
        }
        setStatus("ok", "Guardado en la base de datos");
        editando = null;
        draft = nuevoBorrador(String(q.tema));
        pintarEditor();
        marcarGuardado();
        await recargar();
        flash((edicion ? "Cambios guardados" : "Pregunta añadida") + " · " + total + " en la lista");
        $("#f-preg").focus();
    }
    function limpiar() {
        editando = null;
        draft = nuevoBorrador(draft.tema);
        pintarEditor();
        pintarLista();
        marcarSucio();
        $("#f-preg").focus();
    }

    /* ---------- Lista (paginada desde el servidor) ---------- */
    /* Opciones del selector de tema, agrupadas por bloque. */
    function opcionesSelect(seleccionado) {
        if (!temario.some((b) => b.temas.length)) return [h("option", { value: "", text: "No hay temas todavía" })];
        const partes = [];
        for (const b of temario) {
            if (!b.temas.length) continue;
            const g = h("optgroup", { label: recortar(b.nombre) });
            for (const t of b.temas) {
                g.append(
                    h("option", {
                        value: String(t.id),
                        text: recortar(textoOpcion(t) + (t.preguntas === 0 ? " (sin preguntas)" : "")),
                    }),
                );
            }
            partes.push(g);
        }
        return partes;
    }
    async function cargarTemas() {
        const filtro = $("#f-filtro"),
            filtroActual = filtro.value;
        const selTema = $("#f-tema"),
            temaActual = draft.tema || selTema.value;
        temario = await cliente.temario();
        etiquetas = new Map();
        for (const b of temario) for (const t of b.temas) etiquetas.set(t.id, { ...t, bloque_nombre: b.nombre });

        const suma = temario.reduce((s, b) => s + b.temas.reduce((x, t) => x + t.preguntas, 0), 0);
        filtro.replaceChildren(
            h("option", { value: "", text: "Todos los temas (" + suma + ")" }),
            ...temario
                .filter((b) => b.temas.length)
                .map((b) => {
                    const g = h("optgroup", { label: recortar(b.nombre) });
                    g.append(
                        ...b.temas.map((t) =>
                            h("option", {
                                value: String(t.id),
                                text: recortar(textoOpcion(t) + " (" + t.preguntas + ")"),
                            }),
                        ),
                    );
                    return g;
                }),
        );
        filtro.value = temario.some((b) => b.temas.some((t) => String(t.id) === filtroActual)) ? filtroActual : "";

        const ids = new Set(temario.flatMap((b) => b.temas).map((t) => String(t.id)));
        let elegido = String(temaActual ?? "");
        if (!ids.has(elegido))
            elegido = temario.flatMap((b) => b.temas)[0] ? String(temario.flatMap((b) => b.temas)[0].id) : "";
        draft.tema = elegido;
        selTema.replaceChildren(...opcionesSelect(elegido));
        selTema.value = elegido;
    }
    function parametros(desde) {
        const p = new URLSearchParams({ limite: String(PAGINA), desde: String(desde) });
        if ($("#f-filtro").value !== "") p.set("tema", $("#f-filtro").value);
        const q = $("#f-buscar").value.trim();
        if (q) p.set("q", q);
        return p;
    }
    /* Vuelve a pedir la lista desde el principio, conservando tantas filas como ya había cargadas. */
    async function recargar() {
        const mio = ++envio;
        try {
            await cargarTemas();
            const d = await cliente.preguntasListar(parametros(0));
            if (mio !== envio) return;
            items = d.items;
            total = d.total;
            pintarLista();
        } catch (e) {
            setStatus("warn", "No se pudo cargar la lista: " + msg(e));
        }
    }
    async function masPreguntas() {
        const mio = ++envio;
        try {
            const d = await cliente.preguntasListar(parametros(items.length));
            if (mio !== envio) return;
            items = items.concat(d.items);
            total = d.total;
            pintarLista();
        } catch (e) {
            setStatus("warn", "No se pudo cargar la lista: " + msg(e));
        }
    }
    function pintarLista() {
        $("#count").textContent = total ? "· " + total + (total === 1 ? " pregunta" : " preguntas") : "";
        $("#empty").hidden = items.length > 0;
        $("#btn-more").hidden = items.length >= total;
        $("#list").replaceChildren(
            ...items.map((q) => {
                const et = etiquetas.get(q.tema);
                return h(
                    "li",
                    { class: "item" + (q.id === editando ? " editing" : "") },
                    h(
                        "div",
                        { class: "imain" },
                        h("span", {
                            class: "itag",
                            text: "T" + (et?.numero ?? q.tema),
                            title: et ? etiquetaTema(et) : "",
                        }),
                        h("span", { class: "itext", text: q.pregunta }),
                    ),
                    h("div", {
                        class: "imeta",
                        text:
                            "nº " +
                            q.id +
                            (et ? " · " + et.bloque_nombre : "") +
                            " · " +
                            q.respuestas.length +
                            " opciones · correcta " +
                            LETRAS[q.correcta],
                    }),
                    h(
                        "div",
                        { class: "iact" },
                        h("button", { class: "btn small", type: "button", text: "Editar", onclick: () => editar(q) }),
                        h("button", {
                            class: "btn small",
                            type: "button",
                            text: "Duplicar",
                            onclick: () => duplicar(q),
                        }),
                        confirmable("Borrar", () => borrar(q.id)),
                    ),
                );
            }),
        );
    }
    function confirmable(texto, fn) {
        const b = h("button", { class: "btn small danger", type: "button", text: texto });
        let t = null;
        b.addEventListener("click", () => {
            if (!b.classList.contains("armed")) {
                b.classList.add("armed");
                b.textContent = "¿Seguro?";
                t = setTimeout(() => {
                    b.classList.remove("armed");
                    b.textContent = texto;
                }, 3000);
            } else {
                clearTimeout(t);
                fn();
            }
        });
        return b;
    }
    function cargarEnBorrador(q) {
        draft = {
            tema: String(q.tema),
            pregunta: q.pregunta,
            opciones: q.respuestas.slice(),
            c: q.correcta,
            expl: q.explicacion,
        };
    }
    function editar(q) {
        editando = q.id;
        cargarEnBorrador(q);
        pintarEditor();
        pintarLista();
        $("#f-preg").focus();
        $("#ed-title").scrollIntoView({ block: "start", behavior: "smooth" });
    }
    function duplicar(q) {
        editando = null;
        cargarEnBorrador(q);
        pintarEditor();
        pintarLista();
        $("#f-preg").focus();
        flash("Copia cargada: cambia el enunciado y añádela.");
    }
    async function borrar(id) {
        try {
            await cliente.preguntaBorrar(id);
        } catch (e) {
            flash("No se pudo borrar: " + msg(e), "warn");
            return;
        }
        if (editando === id) {
            editando = null;
            draft = nuevoBorrador(draft.tema);
            pintarEditor();
        }
        await recargar();
    }

    /* ---------- Eventos ---------- */
    $("#f-tema").addEventListener("change", (e) => {
        draft.tema = e.target.value;
        marcarSucio();
    });
    $("#f-preg").addEventListener("input", (e) => {
        draft.pregunta = e.target.value;
        marcarSucio();
    });
    $("#f-expl").addEventListener("input", (e) => {
        draft.expl = e.target.value;
        marcarSucio();
    });
    $("#f-filtro").addEventListener("change", recargar);
    let tBuscar = null;
    $("#f-buscar").addEventListener("input", () => {
        clearTimeout(tBuscar);
        tBuscar = setTimeout(recargar, 250);
    });
    $("#btn-more").addEventListener("click", masPreguntas);
    $("#btn-add-opt").addEventListener("click", anadirOpcion);
    $("#btn-save").addEventListener("click", guardarPregunta);
    $("#btn-cancel").addEventListener("click", limpiar);
    $("#btn-clear").addEventListener("click", limpiar);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.repeat) {
            e.preventDefault();
            guardarPregunta();
        }
    });

    /* ---------- Arranque ---------- */
    pintarEditor();
    $("#f-preg").focus();
    (async () => {
        await recargar();
        const id = Number(new URLSearchParams(location.search).get("editar"));
        if (!Number.isInteger(id) || id <= 0) return;
        try {
            editar(await cliente.preguntaObtener(id));
        } catch (e) {
            flash("No se pudo abrir la pregunta: " + msg(e), "warn");
        }
    })();
})();
