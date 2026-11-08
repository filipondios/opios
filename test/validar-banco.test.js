import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirDb } from "../src/db.js";
import { validarBanco } from "../src/validar-banco.js";
import { DIR_EJEMPLO } from "../src/config.js";

const RAIZ = join(import.meta.dir, "..");
const temporal = () => mkdtempSync(join(tmpdir(), "opios-validar-"));

let repo;
beforeEach(() => { repo = abrirDb(":memory:"); });

describe("validación de un banco (Fase 8.9)", () => {
  test("el banco de ejemplo es válido (sin errores)", async () => {
    const r = await validarBanco(repo, DIR_EJEMPLO);
    expect(r.errores).toEqual([]);
    expect(r.nuevas).toBe(26);
  });

  test("detecta un tema declarado en info.json sin su archivo (aviso)", async () => {
    const dir = temporal();
    try {
      await Bun.write(join(dir, "bloque_1/info.json"), JSON.stringify({
        nombre: "Bloque de prueba",
        temas: [{ numero: 1, titulo: "Con archivo" }, { numero: 2, titulo: "Sin archivo" }],
      }));
      await Bun.write(join(dir, "bloque_1/tema_1.json"), JSON.stringify([
        { pregunta: "¿Uno?", respuestas: ["A", "B"], respuesta_correcta: "a" },
      ]));
      const r = await validarBanco(repo, dir);
      expect(r.errores).toEqual([]);
      expect(r.avisos.some((a) => a.includes("tema 2") && a.includes("tema_2.json"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("una pregunta inválida se cuenta como error", async () => {
    const dir = temporal();
    try {
      await Bun.write(join(dir, "bloque_1/tema_1.json"), JSON.stringify([
        { pregunta: "Con una sola opción", respuestas: ["A"], respuesta_correcta: "a" },
      ]));
      const r = await validarBanco(repo, dir);
      expect(r.errores.length).toBeGreaterThan(0);
      expect(r.nuevas).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("un directorio inexistente es un error", async () => {
    const r = await validarBanco(repo, join(tmpdir(), `opios-no-existe-${Date.now()}`));
    expect(r.errores.length).toBe(1);
  });

  test("el comando `bun run validar` sale 0 con un banco válido y 1 con errores", () => {
    const bueno = Bun.spawnSync({ cmd: ["bun", "scripts/validar.js", DIR_EJEMPLO], cwd: RAIZ, stdout: "pipe", stderr: "pipe" });
    expect(bueno.exitCode).toBe(0);
    expect(bueno.stdout.toString()).toContain("Sin errores");

    const dir = temporal();
    try {
      Bun.write(join(dir, "bloque_1/tema_1.json"), JSON.stringify([
        { pregunta: "Sin opciones válidas", respuestas: [""], respuesta_correcta: "a" },
      ]));
      const malo = Bun.spawnSync({ cmd: ["bun", "scripts/validar.js", dir], cwd: RAIZ, stdout: "pipe", stderr: "pipe" });
      expect(malo.exitCode).toBe(1);
      expect(malo.stderr.toString()).toContain("error:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
