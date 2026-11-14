/* Scan para la tarea 11: los módulos de la capa local/WebView no importan APIs de
   Bun (los imports que sí tienen son sql.js y @capacitor/...). */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const files = [
    "src/local.js",
    "src/adaptador-sqlite-wasm.js",
    "public/js/cliente-local.js",
    "src/android/puente.js",
    "src/android/shell.js",
    "src/android/pagina.js",
];

describe("sin dependencias de Bun en la capa local", () => {
    for (const file of files) {
        test(`${file} no importa APIs de Bun`, () => {
            const codigo = readFileSync(join(import.meta.dir, "..", file), "utf8");
            const imports = codigo.match(/^import\s+.*from\b/gm) ?? [];
            const texto = imports.join("\n");
            expect(texto).not.toMatch(/from ["']bun:/);
            expect(texto).not.toMatch(/\bBun\b/);
        });
    }
});
