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
import { MIGRACIONES, tieneFts5 } from "../src/db/esquema.js";
import { crearApp } from "../src/app.js";
import { almacenBun } from "../src/almacen-bun.js";
import { driverBun } from "../src/driver-bun.js";
import { DatabaseManager } from "../src/gestor-bancos.js";
import { exportarBanco, importarBancoOpios } from "../src/portable.js";
import { importarDirectorio } from "../src/seed-directorio.js";

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

        test("actualizar: un error a mitad revierte el lote entero (F5.4)", async () => {
            const repo = await abrir();
            try {
                const tema = repo.crearTema({ bloque: repo.temario()[0].id, numero: 1, nombre: "Tema" }).id;
                const base = { tema, respuestas: ["a", "b"], correcta: 0, explicacion: "" };
                repo.crear({ ...base, pregunta: "A" });
                repo.crear({ ...base, pregunta: "B", id_externo: "ext-b" });
                const antes = repo.todas();

                /* La primera es nueva; la segunda actualiza `ext-b` con el enunciado de A: 409. */
                expect(() =>
                    repo.importar(
                        [
                            { ...base, pregunta: "Nueva", id_externo: "ext-nueva" },
                            { ...base, pregunta: "A", id_externo: "ext-b" },
                        ],
                        { actualizar: true },
                    ),
                ).toThrow(/mismo enunciado/);
                expect(repo.todas()).toEqual(antes); // ni siquiera quedó la nueva
                expect(repo.contarPreguntas()).toBe(2);
            } finally {
                repo.close();
            }
        });
    });
}
contrato("contrato del repositorio · Bun SQLite", async () => abrirDb(":memory:"));
contrato("contrato del repositorio · SQLite WASM", async () => abrirRepo(await abrirWasm()));

/* --- F5.3/F5.4: actualizar desde el origen da el mismo resultado en ambos drivers --- */
function contratoActualizar(nombre, abrir) {
    describe(nombre, () => {
        /* Pregunta en el formato validado que consume `repo.importar`. */
        const p = (extra = {}) => ({
            bloque: "Bloque 1",
            bloque_numero: 1,
            tema: 1,
            tema_numero: 1,
            respuestas: ["a", "b", "c"],
            correcta: 0,
            explicacion: "",
            ...extra,
        });
        const temaId = (repo, numero) =>
            repo
                .temario()
                .flatMap((b) => b.temas)
                .find((t) => t.numero === numero).id;
        const ids = (repo, tema) =>
            repo
                .paraTest([tema])
                .preguntas.map((x) => x.id)
                .sort((a, b) => a - b);

        test("enunciado cambiado: conserva el id interno y el progreso (v1 -> v2)", async () => {
            const repo = await abrir();
            try {
                await repo.importar([p({ pregunta: "Versión uno", id_externo: "ext-1" })], { actualizar: true });
                const id = repo.todas()[0].id;
                repo.guardarProgreso([{ id, caja: 4, vence: "2999-01-01", aciertos: 5, fallos: 1 }]);

                const r = await repo.importar(
                    [p({ pregunta: "Versión dos", id_externo: "ext-1", explicacion: "nueva" })],
                    { actualizar: true },
                );
                expect(r).toMatchObject({ nuevas: 0, duplicadas: 0, actualizadas: 1, archivadas: 0 });
                expect(repo.todas()).toHaveLength(1);
                expect(repo.obtener(id)).toMatchObject({ pregunta: "Versión dos", explicacion: "nueva" });
                expect(repo.paraTest([temaId(repo, 1)]).progreso[id]).toEqual([4, "2999-01-01", 5, 1]);
            } finally {
                repo.close();
            }
        });

        test("movida de tema: mismo id interno y progreso, en el tema nuevo", async () => {
            const repo = await abrir();
            try {
                await repo.importar([p({ pregunta: "Movida", id_externo: "ext-m" })], { actualizar: true });
                const id = repo.todas()[0].id;
                repo.guardarProgreso([{ id, caja: 2, vence: "2999-01-01", aciertos: 1, fallos: 0 }]);

                const r = await repo.importar(
                    [p({ pregunta: "Movida", id_externo: "ext-m", tema: 2, tema_numero: 2 })],
                    { actualizar: true },
                );
                expect(r).toMatchObject({ actualizadas: 1, archivadas: 0 });
                expect(repo.obtener(id)).toMatchObject({ id, tema_numero: 2 });
                expect(repo.paraTest([temaId(repo, 2)]).progreso[id]).toEqual([2, "2999-01-01", 1, 0]);
                expect(ids(repo, temaId(repo, 1))).toEqual([]);
            } finally {
                repo.close();
            }
        });

        test("ausente: se archiva (nunca se borra) y conserva historial y simulacros", async () => {
            const repo = await abrir();
            try {
                await repo.importar(
                    [
                        p({ pregunta: "Se queda", id_externo: "ext-a" }),
                        p({ pregunta: "Desaparece", id_externo: "ext-b" }),
                    ],
                    { actualizar: true },
                );
                const tema = temaId(repo, 1);
                const [dentro, fuera] = [
                    repo.todas().find((x) => x.id_externo === "ext-a").id,
                    repo.todas().find((x) => x.id_externo === "ext-b").id,
                ];
                repo.guardarProgreso([{ id: fuera, caja: 3, vence: "2999-01-01", aciertos: 2, fallos: 1 }]);
                repo.aplicarSesion([{ id: fuera, acierto: 1, ms: 10 }], [], HOY);
                repo.crearSimulacro(
                    { temas: [tema], segundos: 60, penalizacion: 0, respuestas: [{ id: fuera, elegida: 0 }] },
                    HOY,
                );
                const progresoAntes = repo.db.query("SELECT * FROM progreso WHERE pregunta_id = ?").get(fuera);
                const respuestasAntes = repo.db.query("SELECT COUNT(*) AS n FROM respuestas").get().n;

                const r = await repo.importar([p({ pregunta: "Se queda", id_externo: "ext-a" })], { actualizar: true });
                expect(r).toMatchObject({ actualizadas: 1, archivadas: 1 });
                expect(repo.contarPreguntas()).toBe(2); // fila física: nada se borra
                expect(repo.todas()).toHaveLength(2);
                expect(ids(repo, tema)).toEqual([dentro]); // fuera del estudio
                expect(repo.db.query("SELECT * FROM progreso WHERE pregunta_id = ?").get(fuera)).toEqual(progresoAntes);
                expect(repo.db.query("SELECT COUNT(*) AS n FROM respuestas").get().n).toBe(respuestasAntes);
                expect(repo.contarSimulacros()).toBe(1);

                /* Si vuelve a estar en el origen, se desarchiva. */
                await repo.importar(
                    [
                        p({ pregunta: "Se queda", id_externo: "ext-a" }),
                        p({ pregunta: "Desaparece", id_externo: "ext-b" }),
                    ],
                    { actualizar: true },
                );
                expect(ids(repo, tema)).toEqual([dentro, fuera].sort((a, b) => a - b));
            } finally {
                repo.close();
            }
        });

        test("id_externo ausente: empareja por enunciado y no archiva la existente", async () => {
            const repo = await abrir();
            try {
                await repo.importar([p({ pregunta: "Sin externo" })], { actualizar: true });
                const id = repo.todas()[0].id;
                repo.guardarProgreso([{ id, caja: 2, vence: "2999-01-01", aciertos: 1, fallos: 0 }]);

                const r = await repo.importar([p({ pregunta: "Sin externo", explicacion: "otra" })], {
                    actualizar: true,
                });
                expect(r).toMatchObject({ nuevas: 0, duplicadas: 1, actualizadas: 0, archivadas: 0 });
                expect(repo.todas()).toHaveLength(1); // no duplica
                expect(repo.paraTest([temaId(repo, 1)]).progreso[id]).toEqual([2, "2999-01-01", 1, 0]);
            } finally {
                repo.close();
            }
        });

        test("id_externo repetido en el origen: aborta y deja el banco intacto", async () => {
            const repo = await abrir();
            try {
                await repo.importar([p({ pregunta: "A", id_externo: "ext-a" })], { actualizar: true });
                const antes = repo.todas();
                expect(() =>
                    repo.importar(
                        [p({ pregunta: "B", id_externo: "repe" }), p({ pregunta: "C", id_externo: "repe" })],
                        { actualizar: true },
                    ),
                ).toThrow(/repite el identificador externo/);
                expect(repo.todas()).toEqual(antes);
            } finally {
                repo.close();
            }
        });
    });
}
contratoActualizar("actualizar desde el origen · Bun SQLite", async () => abrirDb(":memory:"));
contratoActualizar("actualizar desde el origen · SQLite WASM", async () => abrirRepo(await abrirWasm()));

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

            /* El PC lo empaqueta (instantánea consistente del driver) y lo restaura. */
            const repoExportar = abrirDb(banco);
            let paquete;
            try {
                paquete = await exportarBanco(driverBun, repoExportar.db, { nombre: "Desde Android" });
            } finally {
                repoExportar.close();
            }
            expect(paquete.manifest).toMatchObject({ preguntas: 7 });

            const restaurado = join(dir, "restaurado.db");
            expect(await importarBancoOpios(driverBun, almacenBun, restaurado, paquete.bytes)).toMatchObject({
                preguntas: 7,
            });

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
        const gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
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

            /* registrar() valida con el filtro único (F2.4): el banco del WebView pasa. */
            const bancoA = await gestor.registrar("Banco A", rutaA);
            const bancoB = await gestor.registrar("Banco B", rutaB);

            await gestor.activar(bancoA.id);
            expect((await gestor.abrirActivo()).paraTest([a.tema]).progreso[a.id]).toEqual([4, "2026-07-01", 2, 1]);
            await gestor.cerrar();

            await gestor.activar(bancoB.id);
            const repoActivoB = await gestor.abrirActivo();
            expect(repoActivoB.contarPreguntas()).toBe(1); // solo la suya, no la del otro banco
            expect(repoActivoB.paraTest([b.tema]).progreso[b.id]).toEqual([2, "2026-07-01", 2, 1]);
            await gestor.cerrar();

            /* Volver al primero no mezcla ni pierde progreso. */
            await gestor.activar(bancoA.id);
            expect((await gestor.abrirActivo()).paraTest([a.tema]).progreso[a.id][0]).toBe(4);
        } finally {
            await gestor.close();
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

/* --- F1.8: el índice FTS5 no viaja entre builds (PC lo trae, sql.js no) --- */
const bunTieneFts5 = (() => {
    const db = new Database(":memory:", { create: true, strict: true });
    const disponible = tieneFts5(db);
    db.close();
    return disponible;
})();

describe("F1.8: banco portátil PC (con FTS5) ↔ Android (sin FTS5)", () => {
    test.skipIf(!bunTieneFts5)("se escribe en sql.js y vuelve a Bun con el índice reconstruido", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-fts5-"));
        try {
            /* PC: banco con el índice FTS5 y una pregunta indexada. */
            const repoPc = abrirDb(join(dir, "pc.db"));
            const bloque = repoPc.crearBloque({ nombre: "Bloque PC" });
            const tema = repoPc.crearTema({ bloque: bloque.id, numero: 1, nombre: "Tema" });
            repoPc.crear({
                tema: tema.id,
                pregunta: "¿Normalización en PC?",
                respuestas: ["sí", "no"],
                correcta: 0,
                explicacion: "",
            });
            expect(repoPc.listar({ texto: "Normalización" }).total).toBe(1);
            repoPc.close();

            /* Android (sql.js, sin FTS5): la sincronización quita los triggers que estorban... */
            const dbWasm = await abrirWasm({ bytes: bytesDe(join(dir, "pc.db")) });
            const repoWasm = abrirRepo(dbWasm);
            expect(
                dbWasm.query("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'preguntas_ai'").get(),
            ).toBeNull();
            /* ...y entonces ESCRIBIR el banco del PC deja de fallar con «no such module: fts5». */
            repoWasm.crear({
                tema: tema.id,
                pregunta: "¿Añadida en Android?",
                respuestas: ["sí", "no"],
                correcta: 1,
                explicacion: "",
            });
            expect(repoWasm.listar({ texto: "Añadida" }).total).toBe(1); // filtro en JS
            const bytesAndroid = dbWasm.exportar();
            repoWasm.close();

            /* De vuelta al PC: se recrean los triggers y se reconstruye el índice, ya con la nueva. */
            const rutaVuelta = join(dir, "vuelta.db");
            writeFileSync(rutaVuelta, bytesAndroid);
            const repoVuelta = abrirDb(rutaVuelta);
            try {
                expect(
                    repoVuelta.db
                        .query("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'preguntas_ai'")
                        .get(),
                ).not.toBeNull();
                expect(repoVuelta.listar({ texto: "Normalización" }).total).toBe(1);
                expect(repoVuelta.listar({ texto: "Android" }).total).toBe(1);
            } finally {
                repoVuelta.close();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
