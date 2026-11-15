/* Biblioteca (F3.2): lista de bancos del catálogo y cambio de banco activo.
   Los datos vienen de cliente.js (nada de fetch aquí). El resumen de progreso lo trae
   /api/bancos solo para el banco activo (es el único abierto; el resto llega en F5). */
import * as cliente from "./cliente.js";
import { h, msgError, simulacroEnCurso } from "./comun.js";

(() => {
    "use strict";

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

    /* Estado vacío (D6): importar o probar con el banco de ejemplo que trae la app. */
    function vacia() {
        const alEjemplo = async () => {
            const b = await importar({ nombre: "Ejemplo", ejemplo: true });
            if (b && (await cambiar(b.id))) location.href = "/";
        };
        const alImportar = async () => {
            const b = await importar();
            if (b) await refrescar();
        };
        return h(
            "div",
            { class: "vacia" },
            h("p", { text: "No hay bancos todavía: importa uno o prueba con el ejemplo." }),
            h("button", { class: "btn", type: "button", onclick: alImportar }, "Importar"),
            h("button", { class: "btn", type: "button", onclick: alEjemplo }, "Probar con el ejemplo"),
        );
    }

    async function refrescar() {
        const caja = $("#biblioteca-caja");
        try {
            const lista = await cliente.bancosListar();
            caja.replaceChildren(lista.length ? h("div", { class: "rejilla-bancos" }, ...lista.map(tarjeta)) : vacia());
            setStatus("ok", lista.length ? `Bancos: ${lista.length}` : "Biblioteca vacía");
        } catch (e) {
            caja.replaceChildren(h("p", { class: "error-biblioteca", text: msgError(e) }));
            setStatus("warn", msgError(e));
        }
    }

    refrescar();
})();
