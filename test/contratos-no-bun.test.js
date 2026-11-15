/* Frontera del bundle WebView (tasks 11 y F1.2).
   1) Los módulos de la capa local/WebView no importan APIs de Bun (sql.js y
      @capacitor/... son sus únicas dependencias).
   2) El bundle que se empaqueta para Android (scripts/empaquetar.js) no puede usar
      `process.env`, `Bun`, `bun:` ni `node:` —en el WebView no existe ninguno— y debe
      poder evaluarse en un contexto `vm` sin `process` con unos pocos stubs. */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

const RAIZ = join(import.meta.dir, "..");

const files = [
    "src/local.js",
    "src/adaptador-sqlite-wasm.js",
    "src/banco-id.js",
    "public/js/cliente-local.js",
    "src/android/puente.js",
    "src/android/persistencia.js",
    "src/android/shell.js",
    "src/android/pagina.js",
];

describe("sin dependencias de Bun en la capa local", () => {
    for (const file of files) {
        test(`${file} no importa APIs de Bun`, () => {
            const codigo = readFileSync(join(RAIZ, file), "utf8");
            const imports = codigo.match(/^import\s+.*from\b/gm) ?? [];
            const texto = imports.join("\n");
            expect(texto).not.toMatch(/from ["']bun:/);
            expect(texto).not.toMatch(/\bBun\b/);
        });
    }
});

/* --- Bundle para el WebView (F1.2) ---
   Mismo build que scripts/empaquetar.js. Se construye dos veces: el real (con
   @capacitor/filesystem dentro) para inspeccionarlo, y una variante con ese paquete
   externo para poder sustituirlo por un stub en el `vm` (su implementación web usa
   IndexedDB, que no existe en el contexto de pruebas). */
const dir = mkdtempSync(join(tmpdir(), "opios-bundle-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function empaquetar(nombre, opciones = {}) {
    const r = await Bun.build({
        entrypoints: [join(RAIZ, "src/android/shell.js")],
        outdir: dir,
        naming: nombre,
        target: "browser",
        format: "esm",
        ...opciones,
    });
    if (!r.success) throw new Error(r.logs.map((l) => l.message ?? l).join("\n"));
    return readFileSync(join(dir, nombre), "utf8");
}

const bundle = await empaquetar("opios.js");
const bundleVm = (await empaquetar("opios-vm.js", { external: ["@capacitor/filesystem", "@capacitor/app"] })).replace(
    /import\s*\{[^}]*\}\s*from\s*["']@capacitor\/(?:filesystem|app)["'];?/g,
    "",
);

describe("bundle del WebView (F1.2)", () => {
    test("no usa `process.env`, `Bun`, `bun:` ni `node:`", () => {
        expect(bundle).not.toMatch(/process\.env/);
        expect(bundle).not.toMatch(/\bBun\./);
        /* Solo cuentan los specifiers entre comillas: `node:` aparece también como clave
           de objeto interna de sql.js (`{ node: ... }`), que no es una dependencia. */
        expect(bundle).not.toMatch(/["']bun:/);
        expect(bundle).not.toMatch(/["']node:/);
    });

    test("se evalúa sin `process`, arranca la portada y guarda el banco", async () => {
        const wasm = await Bun.file(join(RAIZ, "node_modules/sql.js/dist/sql-wasm.wasm")).arrayBuffer();
        const escritos = [];
        const guardados = [];
        const documento = {
            addEventListener() {},
            open() {},
            write: (html) => escritos.push(html),
            close() {},
            body: { textContent: null },
            currentScript: null,
        };
        /* Sin `process` ni `Bun`: si el bundle necesitara alguno, la evaluación fallaría. */
        const contexto = vm.createContext({
            console: { log() {}, error() {}, warn() {} },
            window: { addEventListener() {} },
            document: documento,
            location: { pathname: "/", href: "http://opios.local/" },
            history: { pushState() {} },
            Request,
            Response,
            URL,
            WebAssembly,
            TextDecoder,
            TextEncoder,
            btoa,
            atob,
            setTimeout,
            clearTimeout,
            fetch: async () => ({ ok: true, arrayBuffer: async () => wasm }), // sirve sql-wasm.wasm
            App: { addListener: async () => ({ remove() {} }) },
            Filesystem: {
                readFile: async () => {
                    throw new Error("no hay banco guardado"); // primer arranque
                },
                stat: async () => {
                    throw new Error("no hay banco guardado");
                },
                writeFile: async ({ data }) => guardados.push(data),
                rename: async () => {},
                deleteFile: async () => {},
            },
            Directory: { Data: "DATA" },
        });

        await vm.runInContext(`(async () => {\n${bundleVm}\n})()`, contexto, { timeout: 30_000 });
        await new Promise((r) => setTimeout(r, 600)); // deja vencer el debounce del guardado (F1.4)

        expect(vm.runInContext("typeof globalThis.__opios", contexto)).toBe("function");
        expect(escritos.some((html) => /<title>Opios/i.test(html))).toBe(true); // portada pintada
        /* El puente persistió: el último guardado es un SQLite válido (base64). */
        expect(guardados.length).toBeGreaterThan(0);
        expect(Buffer.from(guardados.at(-1), "base64").subarray(0, 15).toString()).toBe("SQLite format 3");
    });
});
