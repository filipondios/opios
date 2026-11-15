/* API y página de la biblioteca (F3.1–F3.3): /api/bancos sobre el DatabaseManager real
   (driver Bun, almacén fs) y las páginas /biblioteca. En modo directo (sin gestor) las
   rutas de bancos fallan con 409 y la página sigue existiendo. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

describe("asistente de importación en el gestor (F3.4–F3.6)", () => {
    test("inspeccionar e importarBytes: json, .opios, duplicados por uuid/nombre y fusión con progreso", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-asistente-"));
        const gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
        try {
            /* Fuente con id_externo: así la fusión puede demostrar que conserva ids y progreso. */
            const dirFusion = join(dir, "fuente");
            mkdirSync(dirFusion);
            writeFileSync(
                join(dirFusion, "tema_1.json"),
                JSON.stringify([
                    {
                        tema: 1,
                        pregunta: "¿Uno?",
                        respuestas: ["A", "B"],
                        respuesta_correcta: "a",
                        id_externo: "ext-1",
                        explicacion: "",
                    },
                    {
                        tema: 1,
                        pregunta: "¿Dos?",
                        respuestas: ["A", "B"],
                        respuesta_correcta: "b",
                        id_externo: "ext-2",
                        explicacion: "",
                    },
                ]),
            );
            const b1 = await gestor.importarJson("Original", dirFusion);
            expect(b1).toMatchObject({ preguntas: 2 });
            expect(b1.uuid_banco).toBeTruthy();

            /* JSON: la previsualización valida de verdad (ensayo en memoria) y detecta el
               duplicado por nombre; los errores salen en español con archivo y nº. */
            const preJson = await gestor.inspeccionar(
                new TextEncoder().encode(
                    JSON.stringify([{ tema: 1, pregunta: "¿X?", respuestas: ["A", "B"], respuesta_correcta: "a" }]),
                ),
                { nombre: "Original" },
            );
            expect(preJson).toMatchObject({ tipo: "json", preguntas: 1, duplicado: { id: b1.id, por: "nombre" } });
            const roto = JSON.stringify([{ pregunta: "", respuestas: ["A", "B"], respuesta_correcta: "a" }]);
            const preMalo = await gestor.inspeccionar(new TextEncoder().encode(roto));
            expect(preMalo.errores).toHaveLength(1);
            expect(preMalo.errores[0]).toMatch(/importado\.json #1:/);

            /* .opios: duplicado por uuid del manifest + banco interno. */
            const { bytes } = await gestor.exportar(b1.id);
            expect(await gestor.inspeccionar(bytes)).toMatchObject({
                tipo: "opios",
                preguntas: 2,
                duplicado: { id: b1.id, por: "uuid" },
            });

            /* «Importar como nuevo» de un duplicado: nombre auto-ajustado, sin choques. */
            const copia = await gestor.importarBytes(bytes, { nombre: "Original" });
            expect(copia.nombre).toBe("Original (2)");
            expect((await gestor.listar()).length).toBe(2);

            /* Fusión en el activo: actualiza por id_externo y conserva el progreso. */
            await gestor.activar(b1.id);
            const repo = await gestor.abrirActivo();
            const pid = repo.db.query("SELECT id FROM preguntas WHERE id_externo = 'ext-1'").get().id;
            repo.guardarProgreso([{ id: pid, caja: 3, vence: "2026-01-01", aciertos: 5, fallos: 1 }]);
            const conProgreso = (await gestor.exportar(b1.id)).bytes;
            const r = await gestor.importarBytes(conProgreso, { modo: "actualizar", id: b1.id });
            expect(r).toMatchObject({ nuevas: 0, duplicadas: 0, actualizadas: 2, banco: b1.ruta, nombre: "Original" });
            expect(repo.db.query("SELECT pregunta_id, caja, aciertos FROM progreso").get()).toMatchObject({
                pregunta_id: pid,
                caja: 3,
                aciertos: 5,
            });

            /* Fusión en un banco NO abierto: libera la conexión, fusiona y reabre el activo. */
            await gestor.activar(copia.id);
            await gestor.abrirActivo();
            const r2 = await gestor.importarBytes(conProgreso, { modo: "actualizar", id: b1.id });
            expect(r2.actualizadas).toBe(2);
            expect((await gestor.abrirActivo()).contarPreguntas()).toBe(2); // el activo sigue abierto

            /* zip: detectado pero aún sin importación (llega con F4). */
            expect(await gestor.inspeccionar(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]))).toMatchObject({
                tipo: "zip",
                soportado: false,
            });
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

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

    test("asistente por HTTP (F3.4): inspeccionar e importar-archivo, con 415/400 y auto-sufijo", async () => {
        const bytesJson = new TextEncoder().encode(
            JSON.stringify([
                { tema: 1, pregunta: "¿Extra?", respuestas: ["A", "B"], respuesta_correcta: "a", explicacion: "" },
            ]),
        );
        const petBytes = (ruta, bytes) =>
            app(
                new Request("http://localhost" + ruta, {
                    method: "POST",
                    headers: { "Content-Type": "application/octet-stream" },
                    body: bytes,
                }),
            );

        let r = await petBytes("/api/bancos/inspeccionar?nombre=Ejemplo%20Renombrado", bytesJson);
        expect(r.status).toBe(200);
        const pre = await r.json();
        expect(pre).toMatchObject({ tipo: "json", preguntas: 1, duplicado: { por: "nombre" } });

        /* Content-type incorrecto → 415; actualizar sin id → 400. */
        r = await app(
            new Request("http://localhost/api/bancos/inspeccionar", { method: "POST", headers: JSON_H, body: "{}" }),
        );
        expect(r.status).toBe(415);
        r = await petBytes("/api/bancos/importar-archivo?modo=actualizar", bytesJson);
        expect(r.status).toBe(400);

        /* Importar dos veces lo mismo como nuevo: el segundo queda «Extra (2)». */
        r = await petBytes("/api/bancos/importar-archivo?nombre=Extra", bytesJson);
        expect(r.status).toBe(201);
        expect((await r.json()).nombre).toBe("Extra");
        r = await petBytes("/api/bancos/importar-archivo?nombre=Extra", bytesJson);
        expect((await r.json()).nombre).toBe("Extra (2)");
    });
});
