/* Contrato de la UI (task 10 del TODO): los módulos de página consumen `cliente.js`
   (operaciones con nombre). Solo `comun.js` (transporte) y `cliente.js` (interfaz de
   datos) pueden tocar `api()`/`fetch()`. Así la UI funciona igual sobre servicios
   locales en Android: se cambia `cliente.js`, no las páginas. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../public/js");
const PAGINAS = readdirSync(DIR).filter((f) => f.endsWith(".js") && f !== "comun.js" && f !== "cliente.js");

const sinComentarios = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("contratos de la UI", () => {
    test("las páginas no llaman a api() ni fetch() directamente: pasan por cliente.js", () => {
        for (const archivo of PAGINAS) {
            const codigo = sinComentarios(readFileSync(join(DIR, archivo), "utf8"));
            expect(codigo, `${archivo} debe usar cliente.js en vez de api()/fetch()`).not.toMatch(/\b(api|fetch)\s*\(/);
        }
    });

    test("cliente.js define la interfaz completa y solo toca el transporte, no el DOM", () => {
        const codigo = sinComentarios(readFileSync(join(DIR, "cliente.js"), "utf8"));
        for (const operacion of [
            "temario",
            "test",
            "carga",
            "sesionGuardar",
            "progresoReiniciar",
            "ajustesGuardar",
            "fragmentosTemas",
            "simulacroGuardar",
            "preguntaObtener",
            "preguntaGuardar",
            "preguntaBorrar",
            "preguntasListar",
            "bloquesReordenar",
            "bloqueGuardar",
            "bloqueBorrar",
            "temaGuardar",
            "temaBorrar",
            "bancosListar",
            "bancoImportar",
            "bancoActivar",
            "bancoActualizar",
            "bancoDeshacer",
            "bancoExportar",
            "bancoRenombrar",
            "bancoBorrar",
            "bancoInspeccionar",
            "bancoImportarArchivo",
            "bancoDesvincular",
            "bancoLocalizar",
            "bancoRegistrar",
        ])
            expect(codigo, `cliente.js debe exportar ${operacion}`).toContain(`export const ${operacion}`);
        /* Sin DOM: solo el transporte de comun.js. */
        expect(codigo).not.toMatch(/\bdocument\b/);
    });

    test("cliente-local.js replica exactamente las exportaciones de cliente.js", async () => {
        const cliente = await import(join(DIR, "cliente.js"));
        const local = await import(join(DIR, "cliente-local.js"));
        for (const k of Object.keys(cliente)) {
            expect(local, `cliente-local.js debe exportar ${k}`).toHaveProperty(k);
            expect(typeof local[k]).toBe("function");
        }
        expect(Object.keys(cliente).length).toBe(Object.keys(local).length);
    });

    test("todas las operaciones usadas por las páginas existen en cliente.js", async () => {
        const cliente = await import(join(DIR, "cliente.js"));
        for (const archivo of PAGINAS) {
            const codigo = readFileSync(join(DIR, archivo), "utf8");
            for (const m of codigo.matchAll(/cliente\.(\w+)\(/g))
                expect(typeof cliente[m[1]], `${archivo} usa cliente.${m[1]}, que no existe`).toBe("function");
        }
    });

    /* F1.5: claves de localStorage por banco; los ajustes visuales (tema, un-toque) son globales. */
    test("claveBanco prefija con el banco activo y sin él deja la clave histórica", async () => {
        const { claveBanco } = await import(join(DIR, "comun.js"));
        delete globalThis.__opiosBancoId;
        expect(claveBanco("ti.sel")).toBe("opios.ti.sel");
        globalThis.__opiosBancoId = "banco-1";
        expect(claveBanco("ti.sel")).toBe("opios.banco-1.ti.sel");
        delete globalThis.__opiosBancoId;
    });

    /* 7.5: el aviso solo aparece si la release es realmente más nueva que la app instalada. */
    test("esMayor compara la release con la versión nativa", async () => {
        const { esMayor } = await import(join(DIR, "actualizaciones.js"));
        expect(esMayor("v1.0.1", "1.0.0")).toBe(true);
        expect(esMayor("v1.1.0", "1.0.9")).toBe(true);
        expect(esMayor("v1.0.0", "1.0.0")).toBe(false);
        expect(esMayor("v0.9.9", "1.0.0")).toBe(false);
        expect(esMayor("1.0.0-beta.1", "1.0.0")).toBe(false);
    });

    /* 6.4: una operación larga expone su señal y bloquea la navegación hasta que termina. */
    test("iniciarOperacion publica la señal, cancela y libera el bloqueo", async () => {
        const { iniciarOperacion, senalOperacion } = await import(join(DIR, "comun.js"));
        expect(senalOperacion()).toBeNull();
        const op = iniciarOperacion();
        try {
            expect(senalOperacion()).not.toBeNull();
            expect(globalThis.__opiosOcupado).toBe(true);
            op.cancelar();
            expect(senalOperacion().aborted).toBe(true);
        } finally {
            op.fin();
        }
        expect(senalOperacion()).toBeNull();
        expect(globalThis.__opiosOcupado).toBe(false);
    });

    /* 6.3: el teclado encoge el visualViewport pero no el layout; el CSS necesita el solape. */
    test("altoTeclado mide solo el solape y nunca es negativo", async () => {
        const { altoTeclado } = await import(join(DIR, "comun.js"));
        expect(altoTeclado(null, 800)).toBe(0);
        expect(altoTeclado({ height: 500, offsetTop: 0 }, 800)).toBe(300);
        expect(altoTeclado({ height: 800, offsetTop: 0 }, 800)).toBe(0);
        expect(altoTeclado({ height: 900, offsetTop: -100 }, 800)).toBe(0);
    });

    test("las páginas usan claveBanco para lo del banco y literales globales para lo visual", () => {
        const test = readFileSync(join(DIR, "test.js"), "utf8");
        expect(test).toContain('claveBanco("ti.sel")');
        expect(test).not.toMatch(/localStorage\.\w+\("ti\.sel"/); // sin clave de banco suelta
        expect(test).toContain('"ti.una-pulsacion"'); // ajuste visual: global

        const simulacro = readFileSync(join(DIR, "simulacro.js"), "utf8");
        expect(simulacro).toContain('claveBanco("simulacro.curso")');
        expect(simulacro).toContain('claveBanco("simulacro.pendiente")');

        /* F2.8: la biblioteca consultará esto antes de cambiar de banco (bloquear/confirmar). */
        const comun = readFileSync(join(DIR, "comun.js"), "utf8");
        expect(comun).toContain('claveBanco("simulacro.curso")');

        const tema = readFileSync(join(DIR, "tema.js"), "utf8");
        expect(tema).toContain('"opios.tema"'); // ajuste visual: global
    });
});
