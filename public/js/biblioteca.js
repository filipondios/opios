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
    /* Fecha local YYYY-MM-DD para el nombre de la copia (no la de UTC de toISOString). */
    const fechaCorta = () => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

    async function exportar(b, conProgreso) {
        const r = await cliente.bancoExportar(b.id, { conProgreso });
        const url = URL.createObjectURL(await r.blob());
        const a = h("a", { href: url, download: `${b.nombre}${conProgreso ? "" : "-sin-progreso"}.opios` });
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

    /* En Android el archivo se elige con el plugin nativo (F4.3/F4.4): copia el documento a
       la caché privada y aquí se lee en bytes y se borra el temporal. */
    const nativo = () => globalThis.Capacitor?.isNativePlatform?.() === true;
    async function leerConSelectorNativo() {
        const { SelectorDocumentos, Filesystem } = globalThis.Capacitor.Plugins;
        const elegido = await SelectorDocumentos.abrir();
        if (elegido.cancelado) return null; // el usuario cerró el selector sin elegir
        try {
            const { data } = await Filesystem.readFile({ path: elegido.ruta, directory: "CACHE" });
            const binario = atob(data);
            return { bytes: Uint8Array.from(binario, (c) => c.charCodeAt(0)), nombre: elegido.nombre };
        } finally {
            Filesystem.deleteFile({ path: elegido.ruta, directory: "CACHE" }).catch(() => {});
        }
    }

    /* Pide un archivo y lo entrega en bytes: plugin nativo en Android, <input type=file> en
       PC. `accept` solo filtra el selector del navegador; el tipo real se valida al leer. */
    async function elegirArchivo(accept, manejar) {
        try {
            if (nativo()) {
                const elegido = await leerConSelectorNativo();
                if (elegido) await manejar(elegido.bytes, elegido.nombre);
                return;
            }
            const input = h("input", { type: "file", accept });
            input.addEventListener("change", async () => {
                const f = input.files[0];
                if (f) await manejar(new Uint8Array(await f.arrayBuffer()), f.name);
                input.remove();
            });
            document.body.append(input);
            input.click();
        } catch (e) {
            setStatus("warn", msgError(e));
        }
    }

    const importarDesdeArchivo = () => elegirArchivo(".opios,.db,.sqlite,.sqlite3,.json,.zip", asistente);

    /* --- "Usar donde está" (F4.1): registrar una SQLite que ya está en el disco del PC.
        El navegador no da la ruta de un archivo elegido con <input type=file>, así que la
        ruta se pide con prompt; el asistente de archivo (copiar a Opios) es el de F3.4. */
    async function usarDondeEsta() {
        const nombre = prompt("Nombre del banco:", "Mi banco")?.trim();
        if (!nombre) return;
        const ruta = prompt(
            "Ruta del archivo .db del banco (p. ej. /home/tu/banco.db):\n" +
                "El archivo sigue donde está: el progreso se guarda dentro y nunca se borra.",
        )?.trim();
        if (!ruta) return;
        try {
            await cliente.bancoRegistrar(nombre, ruta);
            setStatus("ok", `Banco «${nombre}» registrado donde estaba`);
            await refrescar();
        } catch (e) {
            setStatus("warn", msgError(e));
        }
    }

    const EXPLICACION =
        "«Usar donde está» registra un archivo .db que ya tienes en el disco " +
        "(el progreso se guarda en él); «Importar archivo» copia el banco a la carpeta de Opios.";

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
                    `Importado «${r.nombre ?? nombreSugerido}»: ${r.nuevas} nuevas, ${r.duplicadas} duplicadas, ${r.actualizadas} actualizadas${r.archivadas ? `, ${r.archivadas} archivadas` : ""}`,
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

    /* --- Copia completa y restauración (F5.6) --- */

    /* Descarga un `.opios-backup` (zip con todos los bancos y su progreso). */
    async function descargarCopia() {
        try {
            const r = await cliente.bancoCopia();
            const n = Number(r.headers.get("X-Opios-Bancos") ?? 0);
            const avisos = Number(r.headers.get("X-Opios-Avisos") ?? 0);
            const url = URL.createObjectURL(await r.blob());
            const a = h("a", { href: url, download: `copia-opios-${fechaCorta()}.opios-backup` });
            document.body.append(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setStatus(
                avisos ? "warn" : "ok",
                `Copia descargada: ${n} banco(s)${avisos ? ` · ${avisos} aviso(s): alguno no estaba accesible` : ""}`,
            );
        } catch (e) {
            setStatus("warn", msgError(e));
        }
    }

    const restaurarDesdeArchivo = () => elegirArchivo(".opios-backup,.zip", previsualizarCopia);

    /* Previsualiza la copia (qué bancos trae y cuáles ya están) y deja marcar qué restaurar. */
    async function previsualizarCopia(bytes, nombreArchivo) {
        let pre;
        try {
            pre = await cliente.copiaInspeccionar(bytes);
        } catch (e) {
            setStatus("warn", msgError(e));
            panel(
                h("h3", { text: "No se puede restaurar" }),
                h("p", { class: "error-biblioteca", text: msgError(e) }),
                h("button", { class: "btn", type: "button", onclick: refrescar }, "Volver"),
            );
            return;
        }
        if (!pre.bancos.length) {
            setStatus("warn", "La copia no trae ningún banco.");
            return;
        }
        const filas = pre.bancos.map((b) => {
            const input = h("input", { type: "checkbox", checked: true });
            return {
                banco: b,
                input,
                nodo: h(
                    "label",
                    { class: "fila-restaurar" },
                    input,
                    h(
                        "span",
                        null,
                        `${b.nombre} — ${b.preguntas} pregunta(s)`,
                        b.duplicado
                            ? h("span", {
                                  class: "aviso-dup",
                                  text: ` · ya en tu biblioteca como «${b.duplicado.nombre}»: se reemplazará`,
                              })
                            : null,
                    ),
                ),
            };
        });
        const duplicados = pre.bancos.filter((b) => b.duplicado).length;
        setStatus("ok", "Revisa y confirma la restauración");
        panel(
            h("h3", { text: "Restaurar copia" }),
            h("p", {
                class: "meta-banco",
                text: `${nombreArchivo} — ${pre.bancos.length} banco(s)${duplicados ? ` · ${duplicados} ya en tu biblioteca` : ""} · creada ${fmtCuando(pre.creado)}`,
            }),
            duplicados
                ? h("p", {
                      class: "error-biblioteca",
                      text: "Antes de reemplazar un banco se guarda una copia del actual como «.antes-de-restaurar». Desmarca los que no quieras tocar.",
                  })
                : null,
            h("div", { class: "lista-restaurar" }, ...filas.map((f) => f.nodo)),
            h(
                "div",
                { class: "acciones-importar" },
                h(
                    "button",
                    { class: "btn", type: "button", onclick: () => confirmarCopia(bytes, filas) },
                    "Restaurar seleccionados",
                ),
                h("button", { class: "btn", type: "button", onclick: refrescar }, "Cancelar"),
            ),
        );
    }

    async function confirmarCopia(bytes, filas) {
        const elegidos = filas.filter((f) => f.input.checked);
        if (!elegidos.length) {
            setStatus("warn", "No has marcado ningún banco.");
            return;
        }
        const archivos = elegidos.map((f) => f.banco.archivo);
        const reemplaza = elegidos.filter((f) => f.banco.duplicado).length;
        if (
            reemplaza &&
            !confirm(
                `Se reemplazarán ${reemplaza} banco(s) que ya tienes (antes se guarda el actual como «.antes-de-restaurar»). ¿Continuar?`,
            )
        ) {
            setStatus("warn", "Restauración cancelada.");
            return;
        }
        try {
            const { resultados } = await cliente.copiaRestaurar(bytes, { archivos, sobrescribir: reemplaza > 0 });
            const n = (a) => resultados.filter((x) => x.accion === a).length;
            setStatus(
                n("error") ? "warn" : "ok",
                `Restauración: ${n("creado")} creado(s), ${n("reemplazado")} reemplazado(s), ${n("omitido")} omitido(s)${n("error") ? `, ${n("error")} error(es)` : ""}`,
            );
            const descripcion = (r) =>
                r.accion === "omitido"
                    ? `omitido (${r.motivo})`
                    : r.accion === "error"
                      ? `error (${r.mensaje})`
                      : r.accion;
            panel(
                h("h3", { text: "Resultado de la restauración" }),
                h(
                    "ul",
                    { class: "lista-errores" },
                    ...resultados.map((r) =>
                        h("li", {
                            class: r.accion === "error" ? "error-biblioteca" : null,
                            text: `${r.nombre}: ${descripcion(r)}`,
                        }),
                    ),
                ),
                h("button", { class: "btn", type: "button", onclick: refrescar }, "Volver a la biblioteca"),
            );
        } catch (e) {
            setStatus("warn", msgError(e));
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
                `Actualizado: ${r.nuevas} nuevas, ${r.duplicadas} duplicadas, ${r.actualizadas} actualizadas${r.archivadas ? `, ${r.archivadas} archivadas` : ""}`,
            );
            await refrescar();
        };
        const alExportar = async (conProgreso) => {
            await exportar(b, conProgreso);
            setStatus(
                "ok",
                conProgreso ? "Banco exportado con progreso (.opios)" : "Banco exportado sin progreso (.opios)",
            );
        };
        const alRenombrar = async () => {
            const nombre = prompt("Nuevo nombre:", b.nombre)?.trim();
            if (!nombre || nombre === b.nombre) return;
            await cliente.bancoRenombrar(b.id, nombre);
            await refrescar();
        };
        /* Eliminar (F3.7): solo copias gestionadas — borra el archivo de Opios y su progreso.
           Se confirma escribiendo el nombre y se sugiere exportar antes. */
        const alBorrar = async () => {
            if (
                !confirm(
                    `¿Eliminar «${b.nombre}» y su archivo? El progreso de ese banco se pierde.\n` +
                        "Sugerencia: si quieres conservarlo, cancela y usa Exportar antes.",
                )
            )
                return;
            if (prompt(`Para confirmar, escribe el nombre del banco: «${b.nombre}»`)?.trim() !== b.nombre) {
                setStatus("warn", "Confirmación incorrecta: no se eliminó nada.");
                return;
            }
            await cliente.bancoBorrar(b.id);
            setStatus("ok", "Banco eliminado");
            await refrescar();
        };
        /* Desvincular (F3.7): bancos registrados en PC — el archivo externo jamás se borra. */
        const alDesvincular = async () => {
            if (!confirm(`¿Desvincular «${b.nombre}»? Se quita de la biblioteca; su archivo NO se borra.`)) return;
            await cliente.bancoDesvincular(b.id);
            setStatus("ok", "Banco desvinculado (el archivo sigue donde estaba)");
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
            /* Actualizar reimporta desde un directorio JSON del PC: en Android no aplica. */
            nativo() ? null : h("button", { class: "btn small", type: "button", onclick: alActualizar }, "Actualizar"),
            h(
                "button",
                { class: "btn small", type: "button", onclick: () => alExportar(true) },
                "Exportar con progreso",
            ),
            h(
                "button",
                { class: "btn small", type: "button", onclick: () => alExportar(false) },
                "Exportar sin progreso",
            ),
            h("button", { class: "btn small", type: "button", onclick: alRenombrar }, "Renombrar"),
            b.origen === "registrado"
                ? h(
                      "button",
                      { class: "btn small", type: "button", onclick: alDesvincular, disabled: activo },
                      "Desvincular",
                  )
                : h("button", { class: "btn small", type: "button", onclick: alBorrar, disabled: activo }, "Eliminar"),
        ];
    }

    /* Banco con el archivo ausente (F3.8): Localizar reenlaza la ruta (también en el activo:
       es la única salida si el único banco quedó desconectado); Desvincular lo suelta. */
    function botonesAusente(b, activo) {
        const alLocalizar = async () => {
            const ruta = prompt(
                `El archivo de «${b.nombre}» no está en su sitio (${b.ruta}).\n¿Dónde está ahora? Nueva ruta:`,
                b.ruta,
            )?.trim();
            if (!ruta || ruta === b.ruta) return;
            try {
                await cliente.bancoLocalizar(b.id, ruta);
                setStatus("ok", "Banco localizado");
                await refrescar();
            } catch (e) {
                setStatus("warn", msgError(e));
            }
        };
        const alDesvincular = async () => {
            if (!confirm(`¿Desvincular «${b.nombre}»? Se quita de la biblioteca; su archivo NO se borra.`)) return;
            await cliente.bancoDesvincular(b.id);
            setStatus("ok", "Banco desvinculado (el archivo sigue donde estaba)");
            await refrescar();
        };
        return [
            h("button", { class: "btn small", type: "button", onclick: alLocalizar }, "Localizar"),
            h(
                "button",
                { class: "btn small", type: "button", onclick: alDesvincular, disabled: activo },
                "Desvincular",
            ),
        ];
    }

    function tarjeta(b) {
        const activo = !!b.activo;
        const disponible = b.disponible !== false;
        const meta = [
            `${b.preguntas ?? "?"} preguntas`,
            fmtTam(b.tam_bytes),
            `origen: ${b.origen ?? "—"}`,
            `último uso: ${fmtCuando(b.ultima_vez)}`,
        ];
        return h(
            "article",
            { class: "tarjeta-banco" + (activo ? " activa" : "") + (disponible ? "" : " ausente") },
            h(
                "header",
                null,
                h("h3", { text: b.nombre }),
                activo ? h("span", { class: "etiqueta-activa", text: "Activo" }) : null,
                disponible ? null : h("span", { class: "etiqueta-ausente", text: "No disponible" }),
            ),
            b.progreso
                ? h("p", {
                      class: "progreso",
                      text: `${b.progreso.dominadas} dominadas · ${b.progreso.aprendiendo} aprendiendo · ${b.progreso.nuevas} nuevas de ${b.progreso.total}`,
                  })
                : null,
            h("p", { class: "meta", text: meta.join(" · ") }),
            disponible ? null : h("p", { class: "error-biblioteca", text: `No se encuentra su archivo (${b.ruta}).` }),
            h("footer", null, disponible ? botones(b, activo) : botonesAusente(b, activo)),
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
            h("button", { class: "btn", type: "button", onclick: importarDesdeArchivo }, "Importar archivo…"),
            /* "Usar donde está"/"Probar con el ejemplo" son de PC: en Android no hay rutas
               ni carpeta de ejemplo en el WebView (F4.4). */
            nativo() ? null : h("button", { class: "btn", type: "button", onclick: usarDondeEsta }, "Usar donde está…"),
            nativo()
                ? null
                : h("button", { class: "btn", type: "button", onclick: alEjemplo }, "Probar con el ejemplo"),
            nativo() ? null : h("p", { class: "meta-banco", text: EXPLICACION }),
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
                    nativo()
                        ? null
                        : h(
                              "button",
                              { class: "btn small", type: "button", onclick: usarDondeEsta },
                              "Usar donde está…",
                          ),
                    h(
                        "button",
                        { class: "btn small", type: "button", onclick: descargarCopia },
                        "Descargar copia completa",
                    ),
                    h(
                        "button",
                        { class: "btn small", type: "button", onclick: restaurarDesdeArchivo },
                        "Restaurar copia...",
                    ),
                ),
                nativo() ? null : h("p", { class: "meta-banco", text: EXPLICACION }),
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
