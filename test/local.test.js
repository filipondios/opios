/* Task 11: la capa local (src/local.js) sustituye al servidor sin cambiar las páginas. */
import { describe, expect, test } from "bun:test";

import { abrirAdaptadorSqlite } from "../src/adaptador-sqlite-wasm.js";
import { abrirRepo } from "../src/db/index.js";
import { crearAppLocal } from "../src/local.js";
import { importarDirectorio } from "../src/seed.js";

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
});
