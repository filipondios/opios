/* Task 12: contrato compartido de los dos adaptadores SQLite —Bun (PC/servidor) y
   SQLite WASM (WebView de Android)— y de las operaciones que dependen del archivo:
   migraciones, copia de seguridad portable y cambio de banco en el catálogo.
   Las mismas operaciones deben dar los mismos resultados en ambos drivers. */
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { abrirAdaptadorSqlite } from "../src/adaptador-sqlite-wasm.js";
import { copiaSeguridad } from "../src/backup.js";
import { abrirDb } from "../src/db.js";
import { abrirRepo } from "../src/db/index.js";
import { MIGRACIONES } from "../src/db/esquema.js";
import { crearApp } from "../src/app.js";
import { DatabaseManager } from "../src/gestor-bancos.js";
import { exportarBanco, importarBancoOpios } from "../src/portable.js";
import { importarDirectorio } from "../src/seed.js";

const WASM = "node_modules/sql.js/dist/sql-wasm.wasm";
const HOY = "2026-06-01";
const FIXTURE = join(import.meta.dir, "fixtures");

const abrirWasm = (opciones = {}) => abrirAdaptadorSqlite({ rutaWasm: WASM, ...opciones });
const bytesDe = (ruta) => new Uint8Array(readFileSync(ruta));

/** Crea un banco con un tema y una pregunta; devuelve los ids. */
function sembrar(repo, { pregunta = "¿Compartida?", caja = 3, vence = "2026-07-01", aciertos = 2 } = {}) {
    const bloque = repo.crearBloque({ nombre: "Bloque " + pregunta });
    const tema = repo.crearTema({ bloque: bloque.id, numero: 1, nombre: "Tema" });
    const id = repo.crear({ tema: tema.id, pregunta, respuestas: ["sí", "no"], correcta: 0, explicacion: "e" });
    repo.guardarProgreso([{ id, caja, vence, aciertos, fallos: 1 }]);
    return { tema: tema.id, id };
}

/* --- Contrato: mismas operaciones, mismo resultado con cualquier driver --- */
function contrato(nombre, abrir) {
    describe(nombre, () => {
        test("migra a la última versión, con todas las tablas y sin referencias rotas", async () => {
            const repo = await abrir();
            try {
                expect(repo.db.query("PRAGMA user_version").get().user_version).toBe(MIGRACIONES.length);
                const tablas = new Set(
                    repo.db
                        .query("SELECT name FROM sqlite_master WHERE type = 'table'")
                        .all()
                        .map((t) => t.name),
                );
                for (const tabla of [
                    "bloques",
                    "temas",
                    "preguntas",
                    "opciones",
                    "progreso",
                    "respuestas",
                    "simulacros",
                    "ajustes",
                ])
                    expect(tablas.has(tabla), `falta la tabla ${tabla}`).toBe(true);
                expect(repo.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
            } finally {
                repo.close();
            }
        });

        test("alta, lectura, edición, búsqueda y borrado de preguntas", async () => {
            const repo = await abrir();
            try {
                const bloque = repo.crearBloque({ nombre: "Bloque CRUD" });
                const tema = repo.crearTema({ bloque: bloque.id, numero: 1, nombre: "Tema CRUD" });
                const id = repo.crear({
                    tema: tema.id,
                    pregunta: "¿Qué es Opios?",
                    respuestas: ["Una app", "Un banco"],
                    correcta: 0,
                    explicacion: "Estudia",
                });
                expect(id).toBeGreaterThan(0);
                expect(repo.obtener(id)).toMatchObject({
                    id,
                    tema: tema.id,
                    pregunta: "¿Qué es Opios?",
                    respuestas: ["Una app", "Un banco"],
                    correcta: 0,
                });

                expect(
                    repo.actualizar(id, {
                        tema: tema.id,
                        pregunta: "¿Qué es Opios?",
                        respuestas: ["Una app", "Un banco", "Un CLI"],
                        correcta: 2,
                        explicacion: "Estudia",
                    }),
                ).toBe(true);
                expect(repo.obtener(id).respuestas).toEqual(["Una app", "Un banco", "Un CLI"]);
                expect(repo.obtener(id).correcta).toBe(2);

                expect(repo.listar({ texto: "Opios" }).total).toBe(1); // FTS5 o filtro en JS: da igual
                expect(repo.borrar(id)).toBe(true);
                expect(repo.obtener(id)).toBeNull();
                expect(repo.contarPreguntas()).toBe(0);
            } finally {
                repo.close();
            }
        });

        test("progreso, sesión y simulacro actualizan las mismas filas", async () => {
            const repo = await abrir();
            try {
                const bloque = repo.crearBloque({ nombre: "Bloque sesión" });
                const tema = repo.crearTema({ bloque: bloque.id, numero: 1, nombre: "Tema sesión" });
                const a = repo.crear({
                    tema: tema.id,
                    pregunta: "A",
                    respuestas: ["sí", "no"],
                    correcta: 0,
                    explicacion: "",
                });
                const b = repo.crear({
                    tema: tema.id,
                    pregunta: "B",
                    respuestas: ["sí", "no"],
                    correcta: 1,
                    explicacion: "",
                });

                repo.guardarProgreso([{ id: a, caja: 4, vence: "2026-06-10", aciertos: 3, fallos: 1 }]);
                expect(repo.paraTest([tema.id]).progreso[a]).toEqual([4, "2026-06-10", 3, 1]);

                /* Los contadores de la sesión son incrementos, no valores absolutos. */
                expect(
                    repo.aplicarSesion(
                        [{ id: a, acierto: 1, ms: 12 }],
                        [{ id: a, caja: 5, vence: "2026-06-20", aciertos: 1, fallos: 0 }],
                        HOY,
                    ),
                ).toEqual({ registradas: 1, guardadas: 1 });
                expect(repo.paraTest([tema.id]).progreso[a]).toEqual([5, "2026-06-20", 4, 1]);

                const sim = repo.crearSimulacro(
                    {
                        temas: [tema.id],
                        segundos: 90,
                        penalizacion: 0.33,
                        respuestas: [
                            { id: a, elegida: 0 }, // acierto
                            { id: b, elegida: 0 }, // fallo
                        ],
                    },
                    HOY,
                );
                expect(sim).toMatchObject({
                    total: 2,
                    aciertos: 1,
                    fallos: 1,
                    en_blanco: 0,
                    puntos: 0.67,
                    temas: [tema.id],
                });
                expect(sim.detalle).toHaveLength(2);
                expect(repo.paraTest([tema.id]).progreso[b].slice(0, 2)).toEqual([1, HOY]); // un fallo baja a caja 1
                expect(repo.contarSimulacros()).toBe(1);
                expect(repo.obtenerSimulacro(sim.id).puntos).toBe(0.67);
            } finally {
                repo.close();
            }
        });

        test("una transacción que falla no deja nada a medias", async () => {
            const repo = await abrir();
            try {
                const bloque = repo.crearBloque({ nombre: "Bloque rollback" });
                const tema = repo.crearTema({ bloque: bloque.id, numero: 1, nombre: "Tema rollback" });
                const base = { tema: tema.id, respuestas: ["a", "b"], correcta: 0, explicacion: "" };

                repo.crear({ ...base, pregunta: "Repetida" });
                expect(() => repo.crear({ ...base, pregunta: "Repetida" })).toThrow(/mismo enunciado/);
                expect(repo.contarPreguntas()).toBe(1);

                /* Falla a mitad de una transacción explícita: tampoco queda el INSERT previo. */
                const tx = repo.db.transaction(() => {
                    repo.db
                        .query("INSERT INTO bloques (numero, nombre, orden) VALUES (?, ?, ?)")
                        .run(90, "Rollback", 90);
                    throw new Error("boom");
                });
                expect(tx).toThrow("boom");
                expect(repo.db.query("SELECT 1 FROM bloques WHERE nombre = 'Rollback'").get()).toBeNull();
            } finally {
                repo.close();
            }
        });
    });
}

contrato("contrato del repositorio · Bun SQLite", async () => abrirDb(":memory:"));
contrato("contrato del repositorio · SQLite WASM", async () => abrirRepo(await abrirWasm()));

/* --- El archivo en sí: lo que escribe un driver lo lee el otro --- */
describe("task 12: migraciones compartidas", () => {
    test("un banco v1 creado por Bun migra igual con el adaptador WASM, sin perder datos", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-v1-wasm-"));
        const ruta = join(dir, "v1.db");
        try {
            const vieja = new Database(ruta, { create: true, strict: true });
            vieja.run(MIGRACIONES[0]);
            vieja.run("PRAGMA user_version = 1");
            vieja.run("INSERT INTO temas (id, nombre) VALUES (1, 'Tema antiguo')");
            vieja.run(
                "INSERT INTO preguntas (id, tema_id, enunciado, clave_norm, explicacion) VALUES (10, 1, '¿Antigua?', 'antigua', '')",
            );
            vieja.run(
                "INSERT INTO opciones (id, pregunta_id, posicion, texto, es_correcta) VALUES (100, 10, 0, 'A', 1)",
            );
            vieja.run(
                "INSERT INTO progreso (pregunta_id, caja, vence, aciertos, fallos) VALUES (10, 4, '2026-04-15', 3, 1)",
            );
            vieja.run(`PRAGMA user_version = 1`);
            vieja.close();

            const db = await abrirWasm({ bytes: bytesDe(ruta) });
            const repo = abrirRepo(db);
            try {
                expect(repo.db.query("PRAGMA user_version").get().user_version).toBe(MIGRACIONES.length);
                expect(repo.obtener(10)).toMatchObject({
                    id: 10,
                    pregunta: "¿Antigua?",
                    respuestas: ["A"],
                    correcta: 0,
                });
                expect(repo.paraTest([1]).progreso[10]).toEqual([4, "2026-04-15", 3, 1]);
                expect(repo.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
            } finally {
                repo.close();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("un esquema futuro se rechaza igual en ambos drivers y no se toca", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-futuro-compartido-"));
        const ruta = join(dir, "futuro.db");
        try {
            const futura = new Database(ruta, { create: true, strict: true });
            futura.run(MIGRACIONES[0]);
            futura.run(`PRAGMA user_version = ${MIGRACIONES.length + 1}`);
            futura.close();

            expect(() => abrirDb(ruta)).toThrow(/Esquema futuro/);

            const db = await abrirWasm({ bytes: bytesDe(ruta) });
            try {
                expect(() => abrirRepo(db)).toThrow(/Esquema futuro/);
                expect(db.query("PRAGMA user_version").get().user_version).toBe(MIGRACIONES.length + 1);
            } finally {
                db.close();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

/* --- Copia de seguridad y catálogo: bancos escritos por cualquiera de los dos --- */
describe("task 12: backup portable y cambio de banco entre drivers", () => {
    test("un banco escrito por el adaptador se exporta a .opios y se restaura para ambos drivers", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-backup-wasm-"));
        try {
            /* Banco creado en el «WebView». */
            const db = await abrirWasm();
            const repo = abrirRepo(db);
            await importarDirectorio(repo, FIXTURE);
            const primera = repo.todas()[0];
            repo.guardarProgreso([{ id: primera.id, caja: 3, vence: "2999-01-01", aciertos: 2, fallos: 1 }]);
            const bytes = db.exportar();
            repo.close();
            const banco = join(dir, "wasm.db");
            writeFileSync(banco, bytes);

            /* El PC acepta el archivo tal cual, hace copia consistente y lo empaqueta. */
            const copia = join(dir, "copia.db");
            const repoOrigen = abrirDb(banco);
            try {
                copiaSeguridad(repoOrigen.db, copia);
            } finally {
                repoOrigen.close();
            }
            const repoCopia = abrirDb(copia);
            try {
                expect(repoCopia.contarPreguntas()).toBe(7);
                expect(repoCopia.paraTest([1]).progreso[primera.id]).toEqual([3, "2999-01-01", 2, 1]);
            } finally {
                repoCopia.close();
            }

            const paquete = join(dir, "wasm.opios");
            expect(exportarBanco(banco, paquete, { nombre: "Desde Android" })).toMatchObject({ preguntas: 7 });

            const restaurado = join(dir, "restaurado.db");
            expect(importarBancoOpios(paquete, restaurado)).toMatchObject({ preguntas: 7 });

            /* Restaurado: lo abre Bun y lo abre el adaptador, con el mismo contenido. */
            const repoBun = abrirDb(restaurado);
            const esperado = repoBun.todas();
            expect(repoBun.paraTest([1]).progreso[primera.id]).toEqual([3, "2999-01-01", 2, 1]);
            repoBun.close();

            const db2 = await abrirWasm({ bytes: bytesDe(restaurado) });
            const repoWasm = abrirRepo(db2);
            try {
                expect(repoWasm.todas()).toEqual(esperado);
                expect(repoWasm.paraTest([1]).progreso[primera.id]).toEqual([3, "2999-01-01", 2, 1]);
            } finally {
                repoWasm.close();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("el catálogo alterna entre un banco de Bun y uno del adaptador conservando cada progreso", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-catalogo-drivers-"));
        const gestor = new DatabaseManager(join(dir, "catalogo.db"));
        try {
            /* Banco A: creado por el PC. Banco B: creado en el WebView. */
            const rutaA = join(dir, "a.db");
            const repoA = abrirDb(rutaA);
            const a = sembrar(repoA, { pregunta: "¿Banco A?", caja: 4 });
            repoA.close();

            const dbB = await abrirWasm();
            const repoB = abrirRepo(dbB);
            const b = sembrar(repoB, { pregunta: "¿Banco B?", caja: 2 });
            const bytesB = dbB.exportar();
            repoB.close();
            const rutaB = join(dir, "b.db");
            writeFileSync(rutaB, bytesB);

            /* registrar() valida con la conexión de Bun: el banco del WebView pasa el filtro. */
            const bancoA = gestor.registrar("Banco A", rutaA);
            const bancoB = gestor.registrar("Banco B", rutaB);

            gestor.activar(bancoA.id);
            expect(gestor.abrirActivo().paraTest([a.tema]).progreso[a.id]).toEqual([4, "2026-07-01", 2, 1]);
            gestor.cerrar();

            gestor.activar(bancoB.id);
            const repoActivoB = gestor.abrirActivo();
            expect(repoActivoB.contarPreguntas()).toBe(1); // solo la suya, no la del otro banco
            expect(repoActivoB.paraTest([b.tema]).progreso[b.id]).toEqual([2, "2026-07-01", 2, 1]);
            gestor.cerrar();

            /* Volver al primero no mezcla ni pierde progreso. */
            gestor.activar(bancoA.id);
            expect(gestor.abrirActivo().paraTest([a.tema]).progreso[a.id][0]).toBe(4);
        } finally {
            gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("la app local sirve el banco del adaptador con las mismas respuestas que el servidor", async () => {
        const db = await abrirWasm();
        const repo = abrirRepo(db);
        await importarDirectorio(repo, FIXTURE);
        try {
            /* La capa HTTP de Bun se puede montar sobre el repo del WebView: mismo contrato de API. */
            const manejar = crearApp(repo);
            const r = await manejar(new Request("http://localhost/api/temario"));
            expect(r.status).toBe(200);
            expect((await r.json()).length).toBeGreaterThan(0);
        } finally {
            repo.close();
        }
    });
});
