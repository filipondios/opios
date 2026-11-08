import { describe, expect, test } from "bun:test";
import { DIR_EJEMPLO, DIR_PREGUNTAS_POR_DEFECTO, debeImportar, resolverDirPreguntas } from "../src/config.js";

describe("directorio del banco (Fase 8.1)", () => {
  test("OPIOS_PREGUNTAS manda cuando la carpeta existe", () => {
    expect(resolverDirPreguntas({ OPIOS_PREGUNTAS: "/banco" }, (p) => p === "/banco")).toBe("/banco");
  });

  test("si OPIOS_PREGUNTAS no existe, error claro en lugar de caer al ejemplo", () => {
    expect(() => resolverDirPreguntas({ OPIOS_PREGUNTAS: "/no-existe" }, () => false)).toThrow(/OPIOS_PREGUNTAS/);
  });

  test("sin variable: preguntas/ si existe y ejemplo/ si no", () => {
    expect(resolverDirPreguntas({}, (p) => p === DIR_PREGUNTAS_POR_DEFECTO)).toBe(DIR_PREGUNTAS_POR_DEFECTO);
    expect(resolverDirPreguntas({}, () => false)).toBe(DIR_EJEMPLO);
  });

  test("una variable en blanco se ignora", () => {
    expect(resolverDirPreguntas({ OPIOS_PREGUNTAS: "   " }, () => false)).toBe(DIR_EJEMPLO);
  });
});

describe("modo de importación al arrancar (Fase 8.2)", () => {
  test("vacia: solo si la base de datos no tiene preguntas", () => {
    expect(debeImportar("vacia", true, false)).toBe(true);
    expect(debeImportar("vacia", false, false)).toBe(false);
    expect(debeImportar("vacia", false, true)).toBe(false);
  });

  test("no: nunca importa", () => {
    expect(debeImportar("no", true, true)).toBe(false);
    expect(debeImportar("no", false, false)).toBe(false);
  });

  test("auto: con variable siempre; sin variable, solo con la BD vacía", () => {
    expect(debeImportar("auto", false, true)).toBe(true);
    expect(debeImportar("auto", true, false)).toBe(true);
    expect(debeImportar("auto", false, false)).toBe(false);
  });

  test("un modo desconocido es un error", () => {
    expect(() => debeImportar("siempre", false, false)).toThrow(/OPIOS_SEED/);
  });
});
