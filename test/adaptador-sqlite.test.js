/* Task 11: el adaptador SQLite WASM implementa lo que src/db/*.js necesita de Bun, sin Bun. */
import { describe, expect, test } from "bun:test";

import { abrirAdaptadorSqlite, deBase64 } from "../src/adaptador-sqlite-wasm.js";
import { abrirRepo } from "../src/db/index.js";
import { importarDirectorio } from "../src/seed.js";

const WASM = "node_modules/sql.js/dist/sql-wasm.wasm";
const abrir = (opciones = {}) => abrirAdaptadorSqlite({ rutaWasm: WASM, ...opciones });

describe("adaptador sqlite wasm", () => {
    test("migra el esquema completo y acepta el banco de ejemplo", async () => {
        const db = await abrir();
        const repo = abrirRepo(db);
        expect(db.query("PRAGMA user_version").get().user_version).toBe(12);
        const r = await importarDirectorio(repo, "./test/fixtures");
        expect(r.nuevas).toBe(7);
        expect(repo.contarPreguntas()).toBe(7);
        db.close();
    });

    test("run() devuelve { changes, lastInsertRowid } como Bun y ejecuta SQL múltiple", async () => {
        const db = await abrir();
        /* SQL múltiple sin params (como las migraciones): no lanza y ejecuta todo. */
        db.run("PRAGMA foreign_keys = OFF; CREATE TABLE t_prueba (x); PRAGMA foreign_keys = ON;");
        expect(db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 't_prueba'").get().n).toBe(1);
        /* Igual que Bun: siempre { changes, lastInsertRowid }, con el rowid del último INSERT. */
        expect(db.query("INSERT INTO t_prueba (x) VALUES (1)").run()).toEqual({ changes: 1, lastInsertRowid: 1 });
        expect(db.query("UPDATE t_prueba SET x = 2 WHERE x = 99").run()).toEqual({ changes: 0, lastInsertRowid: 1 });
        expect(db.query("SELECT * FROM t_prueba WHERE x = 99").get()).toBeNull(); // Bun: null, no undefined
        db.close();
    });

    test("la persistencia es explícita: exportar() y reabrir con esos bytes", async () => {
        const onCambios = [];
        const db = await abrir({ onCambios: (s) => onCambios.push(s) });
        const repo = abrirRepo(db);
        await importarDirectorio(repo, "./test/fixtures");
        const id = repo.crear({
            tema: 1,
            pregunta: "¿De prueba?",
            respuestas: ["Sí", "No"],
            correcta: 0,
            explicacion: "",
        });
        repo.guardarProgreso([{ id, caja: 3, vence: "2999-01-01", aciertos: 2, fallos: 1 }]);
        expect(onCambios.length).toBeGreaterThan(0); // avisó tras cada escritura

        const bytes = db.exportar();
        db.close();
        const db2 = await abrir({ bytes });
        const repo2 = abrirRepo(db2);
        expect(repo2.contarPreguntas()).toBe(8);
        expect(repo2.paraTest([1]).progreso[id]).toEqual([3, "2999-01-01", 2, 1]);
        db2.close();
    });

    test("guardar con una transacción abierta no falla: el aviso llega tras el COMMIT", async () => {
        /* Antes, onCambios exportaba dentro del BEGIN de migrar()/importar() y sql.js lo
           rechazaba («SQLite is busy or locked»): el WebView no llegaba a guardar nunca. */
        const guardados = [];
        const db = await abrir({ onCambios: (s) => guardados.push(s.exportar()) });
        const repo = abrirRepo(db);
        await importarDirectorio(repo, "./test/fixtures");
        const antes = guardados.length;
        repo.crear({ tema: 1, pregunta: "¿De prueba?", respuestas: ["Sí", "No"], correcta: 0, explicacion: "" });
        expect(guardados.length).toBeGreaterThan(antes);

        const db2 = await abrir({ bytes: guardados.at(-1) });
        expect(abrirRepo(db2).contarPreguntas()).toBe(8); // incluye la recién creada
        db2.close();
        db.close();
    });

    test("acepta bytes en base64 (lo que devuelve Filesystem.readFile) y deBase64 invierte aBase64", async () => {
        const db = await abrir();
        const repo = abrirRepo(db);
        await importarDirectorio(repo, "./test/fixtures");
        const bytes = db.exportar();
        db.close();
        /* Ronda base64 <-> bytes sin perder nada. */
        const b64 = Buffer.from(bytes).toString("base64");
        expect(Buffer.from(deBase64(b64)).equals(Buffer.from(bytes))).toBe(true);
        const db2 = await abrir({ bytes: b64 });
        expect(abrirRepo(db2).contarPreguntas()).toBe(7);
        db2.close();
    });
});
