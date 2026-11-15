/* Biblioteca (F3.2): lista de bancos del catálogo y cambio de banco activo.
   Los datos vienen de cliente.js (nada de fetch aquí). El resumen de progreso lo trae
   /api/bancos solo para el banco activo (es el único abierto; el resto llega en F5). */
import * as cliente from "./cliente.js";
import { h, msgError, simulacroEnCurso } from "./comun.js";

(() => {
    const $ = (s) => document.querySelector(s);
    const setStatus = (kind, text) => {
        const s = $("#status");
        s.dataset.state = kind;
        s.title = text;
        const visible = s.querySelector(".status-text");
        if (visible) visible.textContent = text;
    };

    const fmtTam = (n) =>
        n == null ? "—" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
    const fmtCuando = (s) => {
        if (!s) return "nunca";
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? s : d.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
    };

    /* Cambiar de banco guarda (flush) y cierra el actual en el servidor; con un simulacro a
       mitad se pide confirmación antes (F2.8). La página nueva lleva el banco nuevo inyectado. */
    async function cambiar(id) {
        if (
            simulacroEnCurso() &&
            !confirm("Hay un simulacro a mitad: se guardará y se cerrará al cambiar de banco. ¿Continuar?")
        )
            return false;
        await cliente.bancoActivar(id);
        return true;
    }

    async function exportar(b) {
        const r = await cliente.bancoExportar(b.id);
        const url = URL.createObjectURL(await r.blob());
        const a = h("a", { href: url, download: `${b.nombre}.opios` });
        document.body.append(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    async function importar(cuerpo) {
        const nombre = cuerpo?.nombre ?? prompt("Nombre del banco nuevo:", "Mi banco")?.trim();
        if (!nombre) return null;
        const b = await cliente.bancoImportar({ nombre, ...cuerpo });
        return b;
    }

    /* --- Asistente de importación (F3.4–F3.6): elegir archivo → previsualizar → confirmar.
       El servidor detecta el tipo, valida y avisa de duplicados; aquí se muestra y se
       pregunta. Con duplicado: actualizar (conserva progreso), importar como nuevo o cancelar. */
    let selector = null;
    function importarDesdeArchivo() {
        if (!selector) {
            selector = h("input", { type: "file", accept: ".opios,.db,.sqlite,.sqlite3,.json,.zip" });
            selector.addEventListener("change", async () => {
                const f = selector.files[0];
                if (!f) return;
                try {
                    await asistente(new Uint8Array(await f.arrayBuffer()), f.name);
                } catch (e) {
                    setStatus("warn", msgError(e));
                }
                selector.value = "";
            });
            document.body.append(selector);
        }
        selector.click();
    }

    function listaErrores(items) {
        if (!items?.length) return null;
        return h(
            "details",
            { class: "lista-errores" },
            h("summary", { text: `${items.length} problema(s)` }),
            h("ul", null, ...items.map((e) => h("li", { text: e }))),
        );
    }

    function panel(...kids) {
        const caja = $("#biblioteca-caja");
        caja.replaceChildren(h("div", { class: "dialogo-importar" }, ...kids));
    }

    async function asistente(bytes, nombreArchivo) {
        let pre;
        try {
            pre = await cliente.bancoInspeccionar(bytes, nombreArchivo);
        } catch (e) {
            setStatus("warn", msgError(e));
            panel(
                h("h3", { text: "No se puede importar" }),
                h("p", { class: "error-biblioteca", text: msgError(e) }),
                h("button", { class: "btn", type: "button", onclick: refrescar }, "Volver"),
            );
            return;
        }
        if (pre.soportado === false) {
            setStatus("warn", pre.mensaje);
            panel(
                h("h3", { text: "No se puede importar" }),
                h("p", { class: "error-biblioteca", text: pre.mensaje }),
                h("button", { class: "btn", type: "button", onclick: refrescar }, "Volver"),
            );
            return;
        }
        if (pre.errores?.length) {
            setStatus("warn", `El archivo tiene ${pre.errores.length} error(es)`);
            panel(
                h("h3", { text: "El archivo tiene errores: no se importa" }),
                h("p", { class: "meta-banco", text: `Tipo: ${pre.tipo}. Errores (archivo y nº de pregunta):` }),
                listaErrores(pre.errores),
                h("button", { class: "btn", type: "button", onclick: refrescar }, "Volver"),
            );
            return;
        }

        const dup = pre.duplicado;
        const nombreSugerido = pre.manifest?.nombre || nombreArchivo.replace(/\.[^.]+$/, "").trim() || "Importado";
        const resumen = [
            `Tipo: ${pre.tipo}`,
            `${pre.preguntas} pregunta(s)`,
            pre.version_banco ? `versión del banco: v${pre.version_banco}` : null,
            dup
                ? `ya está en tu biblioteca como «${dup.nombre}» (detectado por ${dup.por === "uuid" ? "su identificador" : "el nombre"})`
                : null,
        ]
            .filter(Boolean)
            .join(" · ");
        setStatus("ok", dup ? "Banco ya importado: elige qué hacer" : "Revisa y confirma la importación");
        panel(
            h("h3", { text: "Importar banco" }),
            h("p", { class: "meta-banco", text: `${nombreArchivo} — ${resumen}` }),
            listaErrores(pre.avisos),
            dup
                ? h("p", {
                      class: "error-biblioteca",
                      text: "Si actualizas, se conservan los ids y el progreso del banco que ya tienes; si lo importas como nuevo, quedará con otro nombre (por ejemplo «X (2)»).",
                  })
                : null,
            h(
                "div",
                { class: "acciones-importar" },
                dup
                    ? h(
                          "button",
                          {
                              class: "btn",
                              type: "button",
                              onclick: () => confirmar({ modo: "actualizar", id: dup.id }),
                          },
                          `Actualizar «${dup.nombre}» (conserva progreso)`,
                      )
                    : null,
                h(
                    "button",
                    {
                        class: "btn",
                        type: "button",
                        onclick: () => confirmar({ modo: "nuevo" }),
                    },
                    dup ? "Importar como nuevo" : "Importar",
                ),
                h("button", { class: "btn", type: "button", onclick: refrescar }, "Cancelar"),
            ),
        );

        async function confirmar(opciones) {
            try {
                const r = await cliente.bancoImportarArchivo(bytes, { nombre: nombreSugerido, ...opciones });
                setStatus(
                    "ok",
                    `Importado «${r.nombre ?? nombreSugerido}»: ${r.nuevas} nuevas, ${r.duplicadas} duplicadas, ${r.actualizadas} actualizadas`,
                );
                await refrescar();
            } catch (e) {
                setStatus("warn", msgError(e));
                panel(
                    h("h3", { text: "La importación falló" }),
                    h("p", { class: "error-biblioteca", text: msgError(e) }),
                    h("button", { class: "btn", type: "button", onclick: refrescar }, "Volver"),
                );
            }
        }
    }

    function botones(b, activo) {
        const alEstudiar = async () => {
            if (activo) return (location.href = "/");
            if (await cambiar(b.id)) location.href = "/";
        };
        const alActualizar = async () => {
            if (!confirm(`Actualizar «${b.nombre}» desde el directorio de preguntas configurado?`)) return;
            const r = await cliente.bancoActualizar(b.id);
            setStatus(
                "ok",
                `Actualizado: ${r.nuevas} nuevas, ${r.duplicadas} duplicadas, ${r.actualizadas} actualizadas`,
            );
            await refrescar();
        };
        const alExportar = async () => {
            await exportar(b);
            setStatus("ok", "Banco exportado (.opios)");
        };
        const alRenombrar = async () => {
            const nombre = prompt("Nuevo nombre:", b.nombre)?.trim();
            if (!nombre || nombre === b.nombre) return;
            await cliente.bancoRenombrar(b.id, nombre);
            await refrescar();
        };
        const alBorrar = async () => {
            if (!confirm(`¿Eliminar «${b.nombre}» y su archivo? El progreso de ese banco se pierde.`)) return;
            await cliente.bancoBorrar(b.id);
            setStatus("ok", "Banco eliminado");
            await refrescar();
        };
        return [
            h(
                "a",
                {
                    class: "btn small",
                    href: "/",
                    onclick: activo
                        ? null
                        : (e) => {
                              e.preventDefault();
                              alEstudiar();
                          },
                },
                "Estudiar",
            ),
            h("button", { class: "btn small", type: "button", onclick: alActualizar }, "Actualizar"),
            h("button", { class: "btn small", type: "button", onclick: alExportar }, "Exportar"),
            h("button", { class: "btn small", type: "button", onclick: alRenombrar }, "Renombrar"),
            h("button", { class: "btn small", type: "button", onclick: alBorrar, disabled: activo }, "Eliminar"),
        ];
    }

    function tarjeta(b) {
        const activo = !!b.activo;
        const meta = [
            `${b.preguntas ?? "?"} preguntas`,
            fmtTam(b.tam_bytes),
            `origen: ${b.origen ?? "—"}`,
            `último uso: ${fmtCuando(b.ultima_vez)}`,
        ];
        return h(
            "article",
            { class: "tarjeta-banco" + (activo ? " activa" : "") },
            h(
                "header",
                null,
                h("h3", { text: b.nombre }),
                activo ? h("span", { class: "etiqueta-activa", text: "Activo" }) : null,
            ),
            b.progreso
                ? h("p", {
                      class: "progreso",
                      text: `${b.progreso.dominadas} dominadas · ${b.progreso.aprendiendo} aprendiendo · ${b.progreso.nuevas} nuevas de ${b.progreso.total}`,
                  })
                : null,
            h("p", { class: "meta", text: meta.join(" · ") }),
            h("footer", null, botones(b, activo)),
        );
    }

    /* Estado vacío (D6): importar (asistente) o probar con el banco de ejemplo que trae la app. */
    function vacia() {
        const alEjemplo = async () => {
            const b = await importar({ nombre: "Ejemplo", ejemplo: true });
            if (b && (await cambiar(b.id))) location.href = "/";
        };
        return h(
            "div",
            { class: "vacia" },
            h("p", { text: "No hay bancos todavía: importa uno o prueba con el ejemplo." }),
            h("button", { class: "btn", type: "button", onclick: importarDesdeArchivo }, "Importar"),
            h("button", { class: "btn", type: "button", onclick: alEjemplo }, "Probar con el ejemplo"),
        );
    }

    async function refrescar() {
        const caja = $("#biblioteca-caja");
        try {
            const lista = await cliente.bancosListar();
            caja.replaceChildren(
                h(
                    "div",
                    { class: "toolbar-biblioteca" },
                    h(
                        "button",
                        { class: "btn small", type: "button", onclick: importarDesdeArchivo },
                        "Importar archivo…",
                    ),
                ),
                lista.length ? h("div", { class: "rejilla-bancos" }, ...lista.map(tarjeta)) : vacia(),
            );
            setStatus("ok", lista.length ? `Bancos: ${lista.length}` : "Biblioteca vacía");
        } catch (e) {
            caja.replaceChildren(h("p", { class: "error-biblioteca", text: msgError(e) }));
            setStatus("warn", msgError(e));
        }
    }

    refrescar();
})();
