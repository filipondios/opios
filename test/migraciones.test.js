import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { abrirDb } from "../src/db.js";
import { MIGRACIONES } from "../src/db/esquema.js";

describe("migraciones", () => {
  test("una base v1 con datos llega a la última versión sin perder nada", () => {
    const dir = mkdtempSync(join(tmpdir(), "opios-migrar-"));
    const ruta = join(dir, "opios.db");

    try {
      /* Base en v1 tal y como la crearía una instalación antigua. */
      const vieja = new Database(ruta, { create: true, strict: true });
      vieja.run(MIGRACIONES[0]);
      vieja.run("PRAGMA user_version = 1");
      vieja.run("INSERT INTO temas (id, nombre) VALUES (1, 'Tema antiguo')");
      vieja.run(`INSERT INTO preguntas (id, tema_id, enunciado, clave_norm, explicacion)
                 VALUES (10, 1, '¿Pregunta antigua?', 'pregunta antigua', 'Explicación antigua')`);
      vieja.run(`INSERT INTO opciones (id, pregunta_id, posicion, texto, es_correcta) VALUES
                 (100, 10, 0, 'A', 0),
                 (101, 10, 1, 'B', 1),
                 (102, 10, 2, 'C', 0)`);
      vieja.run(`INSERT INTO progreso (pregunta_id, caja, vence, aciertos, fallos)
                 VALUES (10, 4, '2026-04-15', 3, 1)`);
      vieja.close();

      const repo = abrirDb(ruta);
      try {
        expect(repo.db.query("PRAGMA user_version").get().user_version).toBe(MIGRACIONES.length);
        expect(repo.db.query("PRAGMA foreign_key_check").all()).toEqual([]);

        /* La pregunta y sus opciones siguen ahí, con el formato que usa la app. */
        expect(repo.obtener(10)).toMatchObject({
          id: 10,
          tema: 1,
          tema_numero: 1,
          tema_nombre: "Tema antiguo",
          bloque_nombre: "Bloque 1",
          pregunta: "¿Pregunta antigua?",
          explicacion: "Explicación antigua",
          respuestas: ["A", "B", "C"],
          correcta: 1,
          id_externo: null,
        });

        /* El progreso del repaso no se pierde. */
        expect(repo.paraTest([1]).progreso[10]).toEqual([4, "2026-04-15", 3, 1]);
        expect(repo.contarPreguntas()).toBe(1);

        /* v2 asignó el tema al Bloque 1 conservando su número; v6 mantuvo el id. */
        expect(repo.db.query("SELECT bloque_id, numero FROM temas WHERE id = 1").get()).toEqual({
          bloque_id: 1,
          numero: 1,
        });

        /* Las tablas creadas por migraciones posteriores existen. */
        const tablas = new Set(
          repo.db
            .query("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all()
            .map((t) => t.name),
        );
        for (const tabla of ["bloques", "simulacros", "respuestas", "ajustes"]) {
          expect(tablas.has(tabla)).toBe(true);
        }
      } finally {
        repo.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
