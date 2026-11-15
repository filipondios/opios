/* API y página de la biblioteca (F3.1–F3.3): /api/bancos sobre el DatabaseManager real
   (driver Bun, almacén fs) y las páginas /biblioteca. En modo directo (sin gestor) las
   rutas de bancos fallan con 409 y la página sigue existiendo. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crearApp } from "../src/app.js";
import { abrirDb } from "../src/db.js";
import { DatabaseManager } from "../src/gestor-bancos.js";
import { almacenBun } from "../src/almacen-bun.js";
import { driverBun } from "../src/driver-bun.js";
import { descontenedor, descomprimir } from "../src/portable.js";
import { DIR_EJEMPLO } from "../src/config-servidor.js";

const DIR_FIXTURE = join(import.meta.dir, "fixtures"); // 7 preguntas
const JSON_H = { "Content-Type": "application/json" };

describe("biblioteca: modo directo (sin gestor)", () => {
    const app = crearApp(abrirDb(":memory:"));

    test("/api/bancos falla con 409 y mensaje claro", async () => {
        const r = await app(new Request("http://localhost/api/bancos"));
        expect(r.status).toBe(409);
        expect((await r.json()).error).toMatch(/biblioteca/i);
    });

    test("activar, importar y el resto también fallan con 409", async () => {
        for (const [ruta, metodo, cuerpo] of [
            ["/api/bancos/importar", "POST", { nombre: "x" }],
            ["/api/bancos/1/activar", "POST", {}],
            ["/api/bancos/1", "DELETE", undefined],
        ]) {
            const r = await app(
                new Request("http://localhost" + ruta, {
                    method: metodo,
                    headers: cuerpo !== undefined ? JSON_H : {},
                    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
                }),
            );
            expect(r.status).toBe(409);
        }
    });

    test("la página /biblioteca existe y el menú lleva «Bancos»", async () => {
        const html = await (await app(new Request("http://localhost/biblioteca"))).text();
        expect(html).toContain('id="biblioteca-caja"');
        expect(html).toContain('href="/biblioteca" aria-current="page">Bancos</a>');
        expect(html).toContain("/js/biblioteca.js");
        expect(html).toContain("/css/biblioteca.css");
        /* Modo directo: sin nombre de banco inyectado, el enlace de cabecera sigue oculto. */
        expect(html).not.toContain("__opiosBancoNombre");
    });
});

describe("biblioteca: modo biblioteca (con gestor)", () => {
    let dir, gestor, app, repoActual, ids;

    const pet = (ruta, metodo = "GET", cuerpo) =>
        app(
            new Request("http://localhost" + ruta, {
                method: metodo,
                headers: cuerpo !== undefined ? JSON_H : {},
                body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
            }),
        );

    test("listar, importar, activar (cambio en caliente), exportar, actualizar, renombrar y borrar", async () => {
        /* --- Preparación: catálogo con dos bancos, uno vacío y otro importado --- */
        dir = mkdtempSync(join(tmpdir(), "opios-bancos-api-"));
        gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
        abrirDb(join(dir, "vacio.db")).close();
        const vacio = await gestor.registrar("Vacio", join(dir, "vacio.db"));
        await gestor.importarJson("Fixtures", DIR_FIXTURE);
        await gestor.activar(vacio.id);
        repoActual = await gestor.abrirActivo();
        ids = Object.fromEntries((await gestor.listar()).map((b) => [b.nombre, b.id]));
        app = crearApp(repoActual, {
            gestor,
            dirPreguntas: DIR_EJEMPLO,
            dirEjemplo: DIR_FIXTURE,
            alActivar: (r) => (repoActual = r),
            banco: () => "uuid-test",
            bancoNombre: () => "Fixtures",
        });

        /* GET: metadatos de F2.7 + resumen de progreso del banco activo. */
        let r = await pet("/api/bancos");
        expect(r.status).toBe(200);
        let lista = await r.json();
        expect(lista.map((b) => b.nombre)).toEqual(["Fixtures", "Vacio"]); // orden por nombre
        const activa = lista.find((b) => b.activo);
        expect(activa.nombre).toBe("Vacio");
        expect(activa).toMatchObject({ origen: "registrado", preguntas: 0 });
        expect(activa.tam_bytes).toBeGreaterThan(0);
        expect(activa.progreso).toMatchObject({ total: 0, dominadas: 0 });

        /* POST importar: crea un banco nuevo desde el directorio por defecto (DIR_EJEMPLO). */
        r = await pet("/api/bancos/importar", "POST", { nombre: "Del Ejemplo" });
        expect(r.status).toBe(201);
        const creado = await r.json();
        expect(creado).toMatchObject({ nombre: "Del Ejemplo", origen: "importado" });
        expect(creado.preguntas).toBeGreaterThan(0);
        expect(existsSync(creado.ruta)).toBe(true);

        /* POST activar: cambia el activo y la app (el repo en caliente) pasa al banco nuevo. */
        r = await pet(`/api/bancos/${creado.id}/activar`, "POST", {});
        expect(r.status).toBe(200);
        expect(await gestor.idActivo()).toBe(creado.id);
        expect(repoActual.contarPreguntas()).toBe(creado.preguntas); // la app ya sirve el otro banco

        /* GET otra vez: el activo nuevo trae su progreso con las preguntas importadas. */
        lista = await (await pet("/api/bancos")).json();
        expect(lista.find((b) => b.activo).progreso.total).toBe(creado.preguntas);

        /* POST exportar: bytes .opios válidos (descomprimir + cabecera + manifest). */
        r = await pet(`/api/bancos/${creado.id}/exportar`, "POST");
        expect(r.status).toBe(200);
        expect(r.headers.get("Content-Disposition")).toContain(".opios");
        const interno = descontenedor(await descomprimir(new Uint8Array(await r.arrayBuffer())));
        expect(interno.manifest).toMatchObject({ formato: 1, nombre: "Del Ejemplo" });
        expect(interno.sqlite.length).toBeGreaterThan(0);
        /* Exportar un banco que no es el activo tampoco rompe la conexión única. */
        expect((await pet(`/api/bancos/${ids.Vacio}/exportar`, "POST")).status).toBe(200);

        /* POST actualizar: reimporta el directorio (idempotente) y refresca metadatos. */
        r = await pet(`/api/bancos/${creado.id}/actualizar`, "POST", {});
        expect(r.status).toBe(200);
        const actualizado = await r.json();
        expect(actualizado).toMatchObject({ nuevas: 0, banco: creado.ruta });
        expect(actualizado.errores).toEqual([]);
        lista = await (await pet("/api/bancos")).json();
        expect(lista.find((b) => b.id === creado.id).preguntas).toBe(creado.preguntas);

        /* PUT renombrar: cambia el nombre; los repetidos y los ids raros fallan con 400. */
        r = await pet(`/api/bancos/${creado.id}`, "PUT", { nombre: "Ejemplo Renombrado" });
        expect(r.status).toBe(200);
        expect((await r.json()).nombre).toBe("Ejemplo Renombrado");
        r = await pet(`/api/bancos/${creado.id}`, "PUT", { nombre: "vacio" }); // COLLATE NOCASE
        expect(r.status).toBe(400);
        r = await pet("/api/bancos/999", "PUT", { nombre: "Nadie" });
        expect(r.status).toBe(400);

        /* DELETE: el activo no se borra; otro sí, con su archivo. */
        r = await pet(`/api/bancos/${creado.id}`, "DELETE");
        expect(r.status).toBe(400);
        r = await pet(`/api/bancos/${ids.Vacio}`, "DELETE");
        expect(r.status).toBe(204);
        expect(existsSync(join(dir, "vacio.db"))).toBe(false);
        lista = await (await pet("/api/bancos")).json();
        expect(lista.some((b) => b.id === ids.Vacio)).toBe(false);
        r = await pet("/api/bancos/999/activar", "POST", {});
        expect(r.status).toBe(400);
    });

    test("la página /biblioteca lleva el banco activo inyectado (id y nombre)", async () => {
        const html = await (await pet("/biblioteca")).text();
        expect(html).toContain("__opiosBancoId=");
        expect(html).toContain("__opiosBancoNombre=");
        expect(html).toContain('id="banco-actual"');
    });
});
