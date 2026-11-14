import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { abrirDb } from "../src/db.js";
import { DatabaseManager } from "../src/gestor-bancos.js";

describe("DatabaseManager (task 5)", () => {
    test("catálogo, duplicados, banco activo y abrir/cerrar", () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-gestor-"));
        const rutaCatalogo = join(dir, "catalogo.db");
        const bancoA = join(dir, "banco-a.db");
        const bancoB = join(dir, "banco-b.db");
        abrirDb(bancoA).close();
        abrirDb(bancoB).close();

        const gestor = new DatabaseManager(rutaCatalogo);
        try {
            const a = gestor.registrar("Banco A", bancoA);
            const b = gestor.registrar("Banco B", bancoB);

            /* Duplicados: misma ruta o mismo nombre se rechazan con error claro. */
            expect(() => gestor.registrar("Otro nombre", bancoA)).toThrow();
            expect(() => gestor.registrar("Banco A", bancoB)).toThrow();
            expect(gestor.listar().length).toBe(2);

            /* Sin banco activo, abrir falla claro. */
            expect(() => gestor.abrirActivo()).toThrow(/banco activo/);
            expect(() => gestor.activar(999)).toThrow(/catálogo/);

            gestor.activar(a.id);
            expect(gestor.listar().find((x) => x.nombre === "Banco A").activo).toBe(true);
            expect(gestor.rutaActiva()).toBe(bancoA);

            /* Abrir da un repo completo y cerrar lo deja limpio. */
            const repo = gestor.abrirActivo();
            expect(repo.contarPreguntas()).toBe(0);
            expect(gestor.abrirActivo()).toBe(repo); // idempotente: una sola conexión
            gestor.cerrar();
            expect(gestor.rutaActiva()).toBe(bancoA); // el activo no cambia al cerrar

            /* Activar otro banco cambia la ruta activa. */
            gestor.activar(b.id);
            expect(gestor.rutaActiva()).toBe(bancoB);

            /* El estado activo sobrevive al reinicio del gestor. */
            gestor.close();
            const reabrir = new DatabaseManager(rutaCatalogo);
            try {
                expect(reabrir.idActivo()).toBe(b.id);
                expect(reabrir.abrirActivo().contarPreguntas()).toBe(0);
                reabrir.cerrar();
            } finally {
                reabrir.close();
            }
        } finally {
            gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("bancos ausentes: registrar y abrir fallan con error claro, no crean bases en silencio", () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-gestor-ausente-"));
        const rutaCatalogo = join(dir, "catalogo.db");
        const gestor = new DatabaseManager(rutaCatalogo);
        try {
            expect(() => gestor.registrar("Fantasma", join(dir, "no-existe.db"))).toThrow(/no existe/);

            const ruta = join(dir, "temporal.db");
            abrirDb(ruta).close();
            const b = gestor.registrar("Temporal", ruta);
            gestor.activar(b.id);
            unlinkSync(ruta);
            expect(() => gestor.abrirActivo()).toThrow(/no está accesible/);
            /* El fallo no creó una base nueva en la ruta ausente. */
            expect(existsSync(ruta)).toBe(false);
        } finally {
            gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("task 7: importar JSON y copiar, con validación y de forma atómica", () => {
    const DIR_FIXTURE = join(import.meta.dir, "fixtures");

    test("importarJson crea un banco completo en el catálogo y lo registra", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-importar-"));
        const gestor = new DatabaseManager(join(dir, "catalogo.db"));
        try {
            const b = await gestor.importarJson("Opositor 2026", DIR_FIXTURE);
            expect(b.ruta).toBe(join(dir, "Opositor-2026.db"));
            expect(b.ruta).not.toBe(b.ruta + ".tmp");
            expect(existsSync(b.ruta)).toBe(true);

            /* El banco nuevo tiene las preguntas de la fixture y queda como activable. */
            gestor.activar(b.id);
            expect(gestor.abrirActivo().contarPreguntas()).toBe(7);
            gestor.cerrar();

            /* Mismo nombre otra vez: la ruta destino ya existe, no se pisa nada. */
            await expect(gestor.importarJson("Opositor 2026", DIR_FIXTURE)).rejects.toThrow(/Ya existe/);
            expect(gestor.listar().length).toBe(1);
        } finally {
            gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("importarJson con JSON inválido no deja banco a medias ni entrada en el catálogo", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-importar-malo-"));
        const gestor = new DatabaseManager(join(dir, "catalogo.db"));
        try {
            const dirMalo = join(dir, "banco-malo");
            mkdirSync(dirMalo, { recursive: true });
            writeFileSync(join(dirMalo, "tema_1.json"), "{ roto");

            await expect(gestor.importarJson("Malo", dirMalo)).rejects.toThrow(/errores/);
            expect(existsSync(join(dir, "Malo.db"))).toBe(false);
            expect(existsSync(join(dir, "Malo.db.tmp"))).toBe(false);
            expect(gestor.listar()).toEqual([]);
        } finally {
            gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("registrar valida que el archivo sea un banco Opios real", () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-validar-"));
        const gestor = new DatabaseManager(join(dir, "catalogo.db"));
        try {
            const texto = join(dir, "texto.db");
            writeFileSync(texto, "esto no es sqlite");
            expect(() => gestor.registrar("Texto", texto)).toThrow(/No se pudo leer como banco Opios/);

            const vacia = join(dir, "vacia.db");
            new Database(vacia, { create: true }).close(); // SQLite válida, pero sin tablas
            expect(() => gestor.registrar("Vacia", vacia)).toThrow(/No es un banco Opios/);

            expect(gestor.listar()).toEqual([]);
        } finally {
            gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("copiar deja el original intacto y registra una copia válida", () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-copiar-"));
        const gestor = new DatabaseManager(join(dir, "catalogo.db"));
        try {
            const original = join(dir, "original.db");
            const repo = abrirDb(original);
            repo.crearTema({ bloque: 1, numero: 1, nombre: "T1" });
            repo.close();

            const copia = gestor.copiar("Copia de seguridad", original);
            expect(copia.ruta).toBe(join(dir, "Copia-de-seguridad.db"));
            expect(existsSync(original)).toBe(true); // el original sigue ahí

            gestor.activar(copia.id);
            expect(gestor.abrirActivo().temario()[0].temas[0].nombre).toBe("T1");
        } finally {
            gestor.close();
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
        const gestor = new DatabaseManager(join(dir, "catalogo.db"));
        try {
            const b = await gestor.importarJson("Banco", bancoJson(dir + "/v1", [P1]));
            gestor.activar(b.id);
            const idOriginal = gestor.abrirActivo().todas()[0].id;
            gestor.abrirActivo().guardarProgreso([{ id: idOriginal, caja: 4, vence: "2999-01-01", aciertos: 5, fallos: 1 }]);
            gestor.cerrar();

            /* Misma id_externo, contenido distinto. */
            const r = await gestor.actualizarActivo(
                bancoJson(dir + "/v2", [{ ...P1, pregunta: "Versión dos", explicacion: "nueva" }]),
            );
            expect(r).toMatchObject({ actualizadas: 1, nuevas: 0 });

            const repo = gestor.abrirActivo();
            const actualizada = repo.todas()[0];
            expect(actualizada).toMatchObject({
                id: idOriginal, // mismo id interno
                pregunta: "Versión dos",
                id_externo: "ext-1",
            });
            expect(repo.paraTest([1]).progreso[idOriginal]).toEqual([4, "2999-01-01", 5, 1]); // progreso intacto
        } finally {
            gestor.close();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("un directorio con errores aborta y el banco queda exactamente igual", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-actualizar-malo-"));
        const gestor = new DatabaseManager(join(dir, "catalogo.db"));
        try {
            const b = await gestor.importarJson("Banco", bancoJson(dir + "/v1", [P1]));
            gestor.activar(b.id);
            const antes = gestor.abrirActivo().todas();
            gestor.cerrar();

            /* La buena vale, la mala no: el lote entero se rechaza, nada a medias. */
            const v2 = [
                { ...P1, pregunta: "Versión dos" },
                { pregunta: "Sin respuestas válidas", respuestas: ["solo una"], respuesta_correcta: "a" },
            ];
            expect(() => gestor.actualizarActivo(bancoJson(dir + "/v2", v2))).toThrow(/error/);

            gestor.abrirActivo();
            expect(gestor.abrirActivo().todas()).toEqual(antes); // ni una pregunta nueva
        } finally {
            gestor.close();
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
