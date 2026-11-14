/* Contrato del núcleo (task 3 del TODO): servicios, API y vistas no pueden tocar la SQLite
   directamente ni las APIs de Bun. Así el núcleo se puede reutilizar tal cual en Android. */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const NUCLEO = [
    "src/servicios.js",
    "src/api.js",
    "src/web.js",
    ...readdirSync(join(import.meta.dir, "../src/views")).map((f) => `src/views/${f}`),
];

/* Prohibido en el núcleo: la conexión y sus primitivas, o APIs de Bun.
   Se ignora lo que esté en comentarios (la documentación sí puede mencionarlo). */
const PROHIBIDO = [
    ["bun:sqlite", /\bbun:sqlite\b/],
    ["API Bun (Bun.*)", /\bBun\.[a-zA-Z]/],
    ["primitivas SQLite (query/transaction)", /\.(query|transaction)\s*\(/],
    ["escritura directa (db.run)", /\bdb\.run\s*\(/],
    ["la conexión expuesta (repo.db / .db)", /\b(repo|datos)\.db\b/],
];

const sinComentarios = (codigo) =>
    codigo
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1")
        .replace(/(^|[^:'"])\/\/.*$/gm, "$1");

describe("contratos del núcleo", () => {
    test("el núcleo solo usa el repo público: nada de SQLite directa ni APIs de Bun", () => {
        for (const ruta of NUCLEO) {
            const codigo = sinComentarios(readFileSync(join(import.meta.dir, "..", ruta), "utf8"));
            for (const [descripcion, patron] of PROHIBIDO) {
                const mal = patron.exec(codigo);
                expect(mal, `${ruta} usa ${descripcion} en «${mal?.[0] ?? ""}»`).toBeNull();
            }
        }
    });

    test("el adaptador HTTP de Bun sí puede usar Bun (ahí vive ese acoplamiento)", () => {
        const codigo = sinComentarios(readFileSync(join(import.meta.dir, "../src/http.js"), "utf8"));
        expect(/\bBun\.(gzipSync|file)\b/.test(codigo)).toBe(true);
    });
});
