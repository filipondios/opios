/* Task 11: la capa local (src/local.js) sustituye al servidor sin cambiar las páginas. */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { abrirAdaptadorSqlite } from "../src/adaptador-sqlite-wasm.js";
import { crearAlmacenMemoria } from "../src/almacen-memoria.js";
import { abrirRepo } from "../src/db/index.js";
import { crearDriverWasm } from "../src/driver-wasm.js";
import { DatabaseManager } from "../src/gestor-bancos.js";
import { crearAppLocal } from "../src/local.js";
import { importarDirectorio } from "../src/seed-directorio.js";

/* Monta una app local sobre un banco de ejemplo. Devuelve `[app, cerrar]`. */
async function appDeEjemplo() {
    const repo = abrirRepo(await abrirAdaptadorSqlite({ rutaWasm: "node_modules/sql.js/dist/sql-wasm.wasm" }));
    await importarDirectorio(repo, "./ejemplo");
    return [crearAppLocal(repo), () => repo.close()];
}

describe("app local (task 11)", () => {
    test("/api/carga devuelve el JSON del estado diario", async () => {
        const [app, cerrar] = await appDeEjemplo();
        try {
            const r = await app(new Request("http://opios.local/api/carga"));
            expect(r.status).toBe(200);
            const j = await r.json();
            expect(j).toHaveProperty("nuevasHoy");
            expect(j).toHaveProperty("cupoNuevas");
            expect(j).toHaveProperty("bloqueadoPorAtraso");
        } finally {
            cerrar();
        }
    });

    test("GET / devuelve HTML de la portada", async () => {
        const [app, cerrar] = await appDeEjemplo();
        try {
            const r = await app(new Request("http://opios.local/"));
            expect(r.status).toBe(200);
            const html = await r.text();
            expect(html).toContain("<!doctype html>");
            expect(html).toContain("Opios");
        } finally {
            cerrar();
        }
    });

    test("una ruta desconocida devuelve 404 JSON", async () => {
        const [app, cerrar] = await appDeEjemplo();
        try {
            const r = await app(new Request("http://opios.local/xyz"));
            expect(r.status).toBe(404);
            expect((await r.json()).error).toBe("Ruta no encontrada.");
        } finally {
            cerrar();
        }
    });

    test("GET /api/temario devuelve la lista de bloques/temas", async () => {
        const [app, cerrar] = await appDeEjemplo();
        try {
            const r = await app(new Request("http://opios.local/api/temario"));
            expect(r.status).toBe(200);
            const bloques = await r.json();
            expect(Array.isArray(bloques)).toBe(true);
            expect(bloques.length).toBeGreaterThan(0);
        } finally {
            cerrar();
        }
    });

    test("el HTML de / contiene los bloques del banco (SSR)", async () => {
        const [app, cerrar] = await appDeEjemplo();
        try {
            const r = await app(new Request("http://opios.local/"));
            expect(r.status).toBe(200);
            expect(await r.text()).toContain("Bloque");
        } finally {
            cerrar();
        }
    });

    test("/maker y /temario se sirven como HTML", async () => {
        for (const ruta of ["/maker", "/temario"]) {
            const [app, cerrar] = await appDeEjemplo();
            try {
                const r = await app(new Request("http://opios.local" + ruta));
                expect(r.status).toBe(200);
                expect(await r.text()).toContain("<!doctype html>");
            } finally {
                cerrar();
            }
        }
    });

    test("el id del banco activo viaja en el HTML para las claves de localStorage (F1.5)", async () => {
        const repo = abrirRepo(await abrirAdaptadorSqlite({ rutaWasm: "node_modules/sql.js/dist/sql-wasm.wasm" }));
        try {
            const app = crearAppLocal(repo, { banco: "banco-1" });
            const html = await (await app(new Request("http://opios.local/"))).text();
            expect(html).toContain('globalThis.__opiosBancoId="banco-1"');
        } finally {
            repo.close();
        }
    });

    test("con gestor, /api/bancos responde 200 sin servidor (F4.4)", async () => {
        const almacen = crearAlmacenMemoria();
        const driver = crearDriverWasm({ rutaWasm: "node_modules/sql.js/dist/sql-wasm.wasm" });
        const gestor = new DatabaseManager({ almacen, driver, rutaCatalogo: "catalogo.db" });
        try {
            const b = await gestor.importarJson("Ejem", join(import.meta.dir, "fixtures"));
            await gestor.activar(b.id);
            const app = crearAppLocal(await gestor.abrirActivo(), { gestor });
            const r = await app(new Request("http://opios.local/api/bancos"));
            expect(r.status).toBe(200);
            expect((await r.json()).map((x) => x.nombre)).toEqual(["Ejem"]);
        } finally {
            await gestor.close();
        }
    });

    test("cliente-local envía los bytes como octet-stream (F3.4/F4.4)", async () => {
        const { bancoInspeccionar } = await import("../public/js/cliente-local.js");
        let capturada = null;
        globalThis.__opios = async (req) => {
            capturada = req;
            return Response.json({ ok: true });
        };
        try {
            await bancoInspeccionar(new Uint8Array([1, 2, 3]), "mi banco.zip");
            expect(capturada.headers.get("content-type")).toBe("application/octet-stream");
            expect(new Uint8Array(await capturada.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
            expect(capturada.url).toContain("nombre=mi%20banco.zip");
        } finally {
            delete globalThis.__opios;
        }
    });
});
