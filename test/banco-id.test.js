/* F1.5: identificador estable del banco activo, guardado en `ajustes`. */
import { describe, expect, test } from "bun:test";
import { idBanco } from "../src/banco-id.js";
import { abrirDb } from "../src/db.js";

describe("id del banco (F1.5)", () => {
    test("se crea una vez y se reutiliza", () => {
        const repo = abrirDb(":memory:");
        try {
            const id = idBanco(repo);
            expect(id).toBeTruthy();
            expect(idBanco(repo)).toBe(id);
            expect(repo.ajustes().uuid_banco).toBe(id);
        } finally {
            repo.close();
        }
    });

    test("dos bancos distintos no comparten id", () => {
        const a = abrirDb(":memory:");
        const b = abrirDb(":memory:");
        try {
            expect(idBanco(a)).not.toBe(idBanco(b));
        } finally {
            a.close();
            b.close();
        }
    });
});
