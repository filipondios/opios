import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { abrirDb } from "../src/db.js";
import { abrirRepo } from "../src/db/index.js";
import { MIGRACIONES } from "../src/db/esquema.js";
import { almacenBun } from "../src/almacen-bun.js";
import { driverBun } from "../src/driver-bun.js";
import { crearAlmacenMemoria } from "../src/almacen-memoria.js";
import { crearDriverWasm } from "../src/driver-wasm.js";
import { DatabaseManager } from "../src/gestor-bancos.js";

describe("DatabaseManager (task 5)", () => {
    test("catálogo, duplicados, banco activo y abrir/cerrar", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-gestor-"));
        const rutaCatalogo = join(dir, "catalogo.db");
        const bancoA = join(dir, "banco-a.db");
        const bancoB = join(dir, "banco-b.db");
        abrirDb(bancoA).close();
        abrirDb(bancoB).close();

        const gestor = new DatabaseManager({ almacen: almacenBun, driver: driverBun, rutaCatalogo });
        try {
            const a = await gestor.registrar("Banco A", bancoA);
            const b = await gestor.registrar("Banco B", bancoB);

            /* Duplicados: misma ruta o mismo nombre se rechazan con error claro. */
            await expect(gestor.registrar("Otro nombre", bancoA)).rejects.toThrow();
            await expect(gestor.registrar("Banco A", bancoB)).rejects.toThrow();
            expect((await gestor.listar()).length).toBe(2);

            /* Sin banco activo, abrir falla claro. */
            await expect(gestor.abrirActivo()).rejects.toThrow(/banco activo/);
            await expect(gestor.activar(999)).rejects.toThrow(/catálogo/);

            await gestor.activar(a.id);
            expect((await gestor.listar()).find((x) => x.nombre === "Banco A").activo).toBe(true);
            expect(await gestor.rutaActiva()).toBe(bancoA);

            /* Abrir da un repo completo y cerrar lo deja limpio. */
            const repo = await gestor.abrirActivo();
            expect(repo.contarPreguntas()).toBe(0);
            expect(await gestor.abrirActivo()).toBe(repo); // idempotente: una sola conexión
            await gestor.cerrar();
            expect(await gestor.rutaActiva()).toBe(bancoA); // el activo no cambia al cerrar

            /* Activar otro banco cambia la ruta activa. */
            await gestor.activar(b.id);
            expect(await gestor.rutaActiva()).toBe(bancoB);

            /* El estado activo sobrevive al reinicio del gestor. */
            await gestor.close();
            const reabrir = new DatabaseManager({ almacen: almacenBun, driver: driverBun, rutaCatalogo });
            try {
                expect(await reabrir.idActivo()).toBe(b.id);
                expect((await reabrir.abrirActivo()).contarPreguntas()).toBe(0);
                await reabrir.cerrar();
            } finally {
                await reabrir.close();
            }
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("bancos ausentes: registrar y abrir fallan con error claro, no crean bases en silencio", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-gestor-ausente-"));
        const rutaCatalogo = join(dir, "catalogo.db");
        const gestor = new DatabaseManager({ almacen: almacenBun, driver: driverBun, rutaCatalogo });
        try {
            await expect(gestor.registrar("Fantasma", join(dir, "no-existe.db"))).rejects.toThrow(/no existe/);

            const ruta = join(dir, "temporal.db");
            abrirDb(ruta).close();
            const b = await gestor.registrar("Temporal", ruta);
            await gestor.activar(b.id);
            unlinkSync(ruta);
            await expect(gestor.abrirActivo()).rejects.toThrow(/no está accesible/);
            /* El fallo no creó una base nueva en la ruta ausente. */
            expect(existsSync(ruta)).toBe(false);
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("task 7: importar JSON y copiar, con validación y de forma atómica", () => {
    const DIR_FIXTURE = join(import.meta.dir, "fixtures");

    test("importarJson crea un banco completo en el catálogo y lo registra", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-importar-"));
        const gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
        try {
            const b = await gestor.importarJson("Opositor 2026", DIR_FIXTURE);
            expect(b.ruta).toBe(join(dir, "Opositor-2026.db"));
            expect(b.ruta).not.toBe(b.ruta + ".tmp");
            expect(existsSync(b.ruta)).toBe(true);

            /* El banco nuevo tiene las preguntas de la fixture y queda como activable. */
            await gestor.activar(b.id);
            expect((await gestor.abrirActivo()).contarPreguntas()).toBe(7);
            await gestor.cerrar();

            /* Mismo nombre otra vez: la ruta destino ya existe, no se pisa nada. */
            await expect(gestor.importarJson("Opositor 2026", DIR_FIXTURE)).rejects.toThrow(/Ya existe/);
            expect((await gestor.listar()).length).toBe(1);
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("importarJson con JSON inválido no deja banco a medias ni entrada en el catálogo", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-importar-malo-"));
        const gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
        try {
            const dirMalo = join(dir, "banco-malo");
            mkdirSync(dirMalo, { recursive: true });
            writeFileSync(join(dirMalo, "tema_1.json"), "{ roto");

            await expect(gestor.importarJson("Malo", dirMalo)).rejects.toThrow(/errores/);
            expect(existsSync(join(dir, "Malo.db"))).toBe(false);
            expect(existsSync(join(dir, "Malo.db.tmp"))).toBe(false);
            expect(await gestor.listar()).toEqual([]);
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("registrar valida que el archivo sea un banco Opios real", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-validar-"));
        const gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
        try {
            const texto = join(dir, "texto.db");
            writeFileSync(texto, "esto no es sqlite");
            await expect(gestor.registrar("Texto", texto)).rejects.toThrow(/No se pudo leer como banco Opios/);

            const vacia = join(dir, "vacia.db");
            new Database(vacia, { create: true }).close(); // SQLite válida, pero sin tablas
            await expect(gestor.registrar("Vacia", vacia)).rejects.toThrow(/No es un banco Opios/);

            expect(await gestor.listar()).toEqual([]);
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("copiar deja el original intacto y registra una copia válida", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-copiar-"));
        const gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
        try {
            const original = join(dir, "original.db");
            const repo = abrirDb(original);
            repo.crearTema({ bloque: 1, numero: 1, nombre: "T1" });
            repo.close();

            const copia = await gestor.copiar("Copia de seguridad", original);
            expect(copia.ruta).toBe(join(dir, "Copia-de-seguridad.db"));
            expect(existsSync(original)).toBe(true); // el original sigue ahí

            await gestor.activar(copia.id);
            expect((await gestor.abrirActivo()).temario()[0].temas[0].nombre).toBe("T1");
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("task 9: actualización del banco activo con id_externo", () => {
    const bancoJson = (dir, preguntas) => {
        mkdirSync(join(dir, "bloque_1"), { recursive: true });
        writeFileSync(
            join(dir, "bloque_1/info.json"),
            JSON.stringify({ nombre: "Bloque de prueba", temas: [{ numero: 1, titulo: "Tema" }] }),
        );
        writeFileSync(join(dir, "bloque_1/tema_1.json"), JSON.stringify(preguntas));
        return dir;
    };
    const P1 = { pregunta: "Versión uno", respuestas: ["A", "B"], respuesta_correcta: "a", id_externo: "ext-1" };

    test("actualiza en sitio conservando el id interno y el progreso", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-actualizar-"));
        const gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
        try {
            const b = await gestor.importarJson("Banco", bancoJson(dir + "/v1", [P1]));
            await gestor.activar(b.id);
            const idOriginal = (await gestor.abrirActivo()).todas()[0].id;
            (await gestor.abrirActivo()).guardarProgreso([
                { id: idOriginal, caja: 4, vence: "2999-01-01", aciertos: 5, fallos: 1 },
            ]);
            await gestor.cerrar();

            /* Misma id_externo, contenido distinto. */
            const r = await gestor.actualizarActivo(
                bancoJson(dir + "/v2", [{ ...P1, pregunta: "Versión dos", explicacion: "nueva" }]),
            );
            expect(r).toMatchObject({ actualizadas: 1, nuevas: 0 });

            const repo = await gestor.abrirActivo();
            const actualizada = repo.todas()[0];
            expect(actualizada).toMatchObject({
                id: idOriginal, // mismo id interno
                pregunta: "Versión dos",
                id_externo: "ext-1",
            });
            expect(repo.paraTest([1]).progreso[idOriginal]).toEqual([4, "2999-01-01", 5, 1]); // progreso intacto
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("un directorio con errores aborta y el banco queda exactamente igual", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-actualizar-malo-"));
        const gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
        try {
            const b = await gestor.importarJson("Banco", bancoJson(dir + "/v1", [P1]));
            await gestor.activar(b.id);
            const antes = (await gestor.abrirActivo()).todas();
            await gestor.cerrar();

            /* La buena vale, la mala no: el lote entero se rechaza, nada a medias. */
            const v2 = [
                { ...P1, pregunta: "Versión dos" },
                { pregunta: "Sin respuestas válidas", respuestas: ["solo una"], respuesta_correcta: "a" },
            ];
            await expect(gestor.actualizarActivo(bancoJson(dir + "/v2", v2))).rejects.toThrow(/error/);

            await gestor.abrirActivo();
            expect((await gestor.abrirActivo()).todas()).toEqual(antes); // ni una pregunta nueva
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("task 6: modo biblioteca PC (CLI y arranque del servidor)", () => {
    const RAIZ = join(import.meta.dir, "..");
    const env = (extra) => ({ ...process.env, OPIOS_PREGUNTAS: "./ejemplo", ...extra });

    test("bun run bancos registra, activa y lista desde el catálogo", () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-biblioteca-"));
        try {
            const banco = join(dir, "banco.db");
            abrirDb(banco).close();
            const catalogo = join(dir, "catalogo.db");

            const r = Bun.spawnSync({
                cmd: ["bun", "scripts/bancos.js", "registrar", "Mi banco", banco],
                cwd: RAIZ,
                env: env({ OPIOS_CATALOGO: catalogo }),
                stdout: "pipe",
                stderr: "pipe",
            });
            expect(r.exitCode).toBe(0);
            expect(r.stdout.toString()).toContain("Registrado");

            const lista = Bun.spawnSync({
                cmd: ["bun", "scripts/bancos.js", "listar"],
                cwd: RAIZ,
                env: env({ OPIOS_CATALOGO: catalogo }),
                stdout: "pipe",
                stderr: "pipe",
            });
            expect(lista.stdout.toString()).toContain("Mi banco");
            expect(lista.stdout.toString()).not.toContain("*"); // aún sin activo

            /* Duplicado: error en una línea, código 1. */
            const dup = Bun.spawnSync({
                cmd: ["bun", "scripts/bancos.js", "registrar", "Otro", banco],
                cwd: RAIZ,
                env: env({ OPIOS_CATALOGO: catalogo }),
                stdout: "pipe",
                stderr: "pipe",
            });
            expect(dup.exitCode).toBe(1);
            expect(dup.stderr.toString()).toContain("error:");
            expect(dup.stderr.toString()).not.toContain("    at ");

            /* Sin OPIOS_CATALOGO el CLI lo dice claro. */
            const sin = Bun.spawnSync({
                cmd: ["bun", "scripts/bancos.js", "listar"],
                cwd: RAIZ,
                env: env(),
                stdout: "pipe",
                stderr: "pipe",
            });
            expect(sin.exitCode).toBe(1);
            expect(sin.stderr.toString()).toContain("OPIOS_CATALOGO");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("el servidor arranca en modo biblioteca y rechaza un catálogo sin banco activo", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-biblioteca-srv-"));
        try {
            /* Catálogo sin banco activo: el servidor no arranca y lo explica. */
            const vacio = join(dir, "vacio.db");
            const fallo = Bun.spawnSync({
                cmd: ["bun", "server.js"],
                cwd: RAIZ,
                env: env({ OPIOS_CATALOGO: vacio }),
                stdout: "pipe",
                stderr: "pipe",
            });
            expect(fallo.exitCode).toBe(1);
            expect(fallo.stderr.toString()).toContain("banco activo");

            /* Con banco activo: arranca y sirve /healthz desde el banco del catálogo. */
            const banco = join(dir, "banco.db");
            abrirDb(banco).close();
            const catalogo = join(dir, "catalogo.db");
            Bun.spawnSync({
                cmd: ["bun", "scripts/bancos.js", "registrar", "Activo", banco],
                cwd: RAIZ,
                env: env({ OPIOS_CATALOGO: catalogo }),
                stdout: "pipe",
                stderr: "pipe",
            });
            Bun.spawnSync({
                cmd: ["bun", "scripts/bancos.js", "activar", "1"],
                cwd: RAIZ,
                env: env({ OPIOS_CATALOGO: catalogo }),
                stdout: "pipe",
                stderr: "pipe",
            });

            const hijo = Bun.spawn({
                cmd: ["bun", "server.js"],
                cwd: RAIZ,
                env: env({ OPIOS_CATALOGO: catalogo, PORT: "8144" }),
                stdout: "pipe",
                stderr: "pipe",
            });
            try {
                let salud = 0;
                for (let i = 0; i < 50 && salud !== 200; i++) {
                    await Bun.sleep(100);
                    try {
                        salud = (await fetch("http://127.0.0.1:8144/healthz")).status;
                    } catch {
                        /* aún no escucha */
                    }
                }
                expect(salud).toBe(200);
            } finally {
                hijo.kill();
                await hijo.exited;
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

/* --- F2.7: metadatos del catálogo y uuid_banco en cada banco --- */
describe("F2.7: metadatos del catálogo", () => {
    test("cada camino de entrada anota origen, tamaño, preguntas y versión; activar pone ultima_vez", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-meta-"));
        const gestor = new DatabaseManager({
            almacen: almacenBun,
            driver: driverBun,
            rutaCatalogo: join(dir, "catalogo.db"),
        });
        try {
            const b = await gestor.importarJson("Importado", join(import.meta.dir, "fixtures"));
            expect(b).toMatchObject({
                origen: "importado",
                preguntas: 7,
                version_banco: MIGRACIONES.length,
            });
            expect(b.tam_bytes).toBeGreaterThan(0);

            const c = await gestor.copiar("Copiado", b.ruta);
            expect(c).toMatchObject({ origen: "copiado", preguntas: 7 });

            const extra = join(dir, "directo.db");
            abrirDb(extra).close();
            const r = await gestor.registrar("Registrado", extra);
            expect(r).toMatchObject({ origen: "registrado", preguntas: 0 });

            const filas = await gestor.listar();
            const porNombre = Object.fromEntries(filas.map((f) => [f.nombre, f]));
            for (const nombre of ["Importado", "Copiado", "Registrado"]) {
                expect(porNombre[nombre].tam_bytes).toBeGreaterThan(0);
                expect(porNombre[nombre].version_banco).toBe(MIGRACIONES.length);
                expect(porNombre[nombre].ultima_vez).toBeNull(); // aún sin activar
            }

            /* Activar anota cuándo se usó por última vez y deja uuid_banco en el banco. */
            await gestor.activar(b.id);
            const activado = (await gestor.listar()).find((f) => f.id === b.id);
            expect(activado.ultima_vez).toBeTruthy();
            expect(Number.isNaN(Date.parse(activado.ultima_vez))).toBe(false);
            const repo = await gestor.abrirActivo();
            expect(repo.ajustes().uuid_banco).toBeTruthy();
            await gestor.cerrar();
        } finally {
            await gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("un catálogo antiguo (sin columnas de metadatos) se completa al abrir", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-meta-viejo-"));
        try {
            /* Catálogo con el esquema de antes de F2.7, con un banco ya dentro. */
            const rutaVieja = join(dir, "catalogo.db");
            const banco = join(dir, "banco.db");
            abrirDb(banco).close();
            const viejo = new Database(rutaVieja, { create: true, strict: true });
            viejo.run(`CREATE TABLE bancos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(nombre)) > 0),
                ruta TEXT NOT NULL UNIQUE,
                creado TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE estado (clave TEXT PRIMARY KEY, valor TEXT);`);
            viejo.query("INSERT INTO bancos (nombre, ruta) VALUES (?, ?)").run("Antiguo", banco);
            viejo.close();

            const gestor = new DatabaseManager({ almacen: almacenBun, driver: driverBun, rutaCatalogo: rutaVieja });
            try {
                const filas = await gestor.listar();
                expect(filas).toHaveLength(1);
                expect(filas[0]).toMatchObject({ nombre: "Antiguo", origen: null, ultima_vez: null });

                /* El gestor antiguo sigue funcionando y anota metadatos de lo nuevo. */
                const otro = join(dir, "otro.db");
                abrirDb(otro).close();
                const nuevo = await gestor.registrar("Nuevo", otro);
                expect(nuevo).toMatchObject({ origen: "registrado" });
                await gestor.activar(nuevo.id);
                expect((await gestor.listar()).find((f) => f.id === nuevo.id).ultima_vez).toBeTruthy();
            } finally {
                await gestor.close();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

/* --- F2.3: el mismo gestor sobre driver/almacén Bun y sobre WASM/memoria --- */
describe("DatabaseManager neutro (F2.3)", () => {
    const WASM = "node_modules/sql.js/dist/sql-wasm.wasm";

    const contextos = [
        [
            "Bun (node:fs)",
            () => {
                const dir = mkdtempSync(join(tmpdir(), "opios-gestor-neutro-"));
                return {
                    almacen: almacenBun,
                    driver: driverBun,
                    base: dir,
                    limpiar: () => rmSync(dir, { recursive: true, force: true }),
                };
            },
        ],
        [
            "WASM (sql.js + memoria)",
            () => ({
                almacen: crearAlmacenMemoria(),
                driver: crearDriverWasm({ rutaWasm: WASM }),
                base: "opios",
                limpiar: () => {},
            }),
        ],
    ];

    for (const [nombre, preparar] of contextos) {
        test(`${nombre}: registrar, importar, copiar y activar sobreviven a cerrar y reabrir`, async () => {
            const ctx = preparar();
            const rutaCatalogo = ctx.base + "/catalogo.db";
            const gestor = new DatabaseManager({ almacen: ctx.almacen, driver: ctx.driver, rutaCatalogo });
            try {
                /* Un banco escrito directamente (a.db) se registra; otro se crea importando JSON. */
                const repoA = abrirRepo(await ctx.driver.abrir(ctx.almacen, ctx.base + "/a.db"));
                const bloque = repoA.crearBloque({ nombre: "Bloque A" });
                const tema = repoA.crearTema({ bloque: bloque.id, numero: 1, nombre: "Tema A" });
                repoA.crear({
                    tema: tema.id,
                    pregunta: "¿A?",
                    respuestas: ["sí", "no"],
                    correcta: 0,
                    explicacion: "",
                });
                await ctx.almacen.escribir(ctx.base + "/a.db", ctx.driver.instantanea(repoA.db));
                repoA.close();

                const a = await gestor.registrar("A", ctx.base + "/a.db");
                const b = await gestor.importarJson("B", join(import.meta.dir, "fixtures"));
                expect(b.ruta).toBe(ctx.base + "/B.db");

                await gestor.activar(b.id);
                expect((await gestor.abrirActivo()).contarPreguntas()).toBe(7);
                await gestor.cerrar();
                await gestor.close();

                /* El catálogo (con su banco activo) sobrevive al reinicio del gestor. */
                const reabrir = new DatabaseManager({ almacen: ctx.almacen, driver: ctx.driver, rutaCatalogo });
                try {
                    expect(await reabrir.idActivo()).toBe(b.id);
                    expect((await reabrir.listar()).map((x) => x.nombre)).toEqual(["A", "B"]);
                    expect((await reabrir.copiar("Copia", ctx.base + "/a.db")).ruta).toBe(ctx.base + "/Copia.db");
                    await reabrir.activar(a.id);
                    expect((await reabrir.abrirActivo()).contarPreguntas()).toBe(1);
                    await reabrir.cerrar();
                } finally {
                    await reabrir.close();
                }
            } finally {
                await gestor.close();
                ctx.limpiar();
            }
        });
    }
});
