/* Contrato de la UI (task 10 del TODO): los módulos de página consumen `cliente.js`
   (operaciones con nombre). Solo `comun.js` (transporte) y `cliente.js` (interfaz de
   datos) pueden tocar `api()`/`fetch()`. Así la UI funciona igual sobre servicios
   locales en Android: se cambia `cliente.js`, no las páginas. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../public/js");
const PAGINAS = readdirSync(DIR).filter((f) => f.endsWith(".js") && f !== "comun.js" && f !== "cliente.js");

const sinComentarios = (codigo) =>
    codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

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
        ])
            expect(codigo, `cliente.js debe exportar ${operacion}`).toContain(`export const ${operacion}`);
        /* Sin DOM ni fetch propio: solo el transporte de comun.js. */
        expect(codigo).not.toMatch(/\bdocument\b|\bfetch\s*\(/);
    });

    test("todas las operaciones usadas por las páginas existen en cliente.js", async () => {
        const cliente = await import(join(DIR, "cliente.js"));
        for (const archivo of PAGINAS) {
            const codigo = readFileSync(join(DIR, archivo), "utf8");
            for (const m of codigo.matchAll(/cliente\.(\w+)\(/g))
                expect(typeof cliente[m[1]], `${archivo} usa cliente.${m[1]}, que no existe`).toBe("function");
        }
    });
});
