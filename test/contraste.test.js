import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Comprueba los pares de tokens que usa la interfaz. No sustituye a una auditoría
   con navegador, pero impide que un cambio de paleta rompa el contraste AA. */

const CSS = readFileSync(join(import.meta.dir, "..", "public", "css", "base.css"), "utf8");

/** Extrae los tokens hexadecimales de un bloque `selector{...}`. */
function tokens(selector) {
    const i = CSS.indexOf(selector);
    expect(i).toBeGreaterThanOrEqual(0);
    const abre = CSS.indexOf("{", i);
    const cierra = CSS.indexOf("}", abre);
    const bloque = CSS.slice(abre + 1, cierra);
    return Object.fromEntries(
        [...bloque.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1].toLowerCase(), m[2]]),
    );
}

const claro = tokens(":root{");
const oscuro = tokens(':root[data-theme="dark"]{');
const oscuroAuto = tokens(':root:not([data-theme="light"]){');

const NOMBRES = [
    "bg",
    "surface",
    "surface-2",
    "hover",
    "line",
    "control",
    "text",
    "text-2",
    "text-3",
    "accent",
    "accent-ink",
    "accent-soft",
    "ok",
    "ok-soft",
    "bad",
    "bad-soft",
    "on-sem",
];

function rgb(hex) {
    let h = hex.slice(1);
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function luminancia(hex) {
    const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a, b) {
    const la = luminancia(a);
    const lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Pares de [frente, fondo, mínimo]. */
const PARES_TEXTO = [
    ["text", "bg"],
    ["text", "surface"],
    ["text", "surface-2"],
    ["text-2", "bg"],
    ["text-2", "surface"],
    ["text-2", "surface-2"],
    ["text-3", "bg"],
    ["text-3", "surface"],
    ["accent-ink", "accent"],
    ["text-2", "accent-soft"],
    ["ok", "ok-soft"],
    ["bad", "bad-soft"],
    ["on-sem", "ok"],
    ["on-sem", "bad"],
];

const PARES_INTERFAZ = [
    ["control", "bg"],
    ["control", "surface"],
    ["control", "surface-2"],
];

describe("contraste de los tokens (Fase 1.1)", () => {
    test("claro y oscuro definen la misma lista de tokens", () => {
        for (const t of [claro, oscuro, oscuroAuto]) {
            expect(Object.keys(t).sort()).toEqual([...NOMBRES].sort());
        }
        // El modo automático y el forzado deben coincidir.
        expect(oscuroAuto).toEqual(oscuro);
    });

    for (const [tema, t] of [
        ["claro", claro],
        ["oscuro", oscuro],
    ]) {
        test(`texto AA (4,5:1) en ${tema}`, () => {
            for (const [frente, fondo] of PARES_TEXTO) {
                const ratio = contraste(t[frente], t[fondo]);
                expect(ratio).toBeGreaterThanOrEqual(4.5);
            }
        });

        test(`elementos de interfaz AA (3:1) en ${tema}`, () => {
            for (const [frente, fondo] of PARES_INTERFAZ) {
                const ratio = contraste(t[frente], t[fondo]);
                expect(ratio).toBeGreaterThanOrEqual(3);
            }
        });
    }

    test("el anillo de foco usa el texto con contraste suficiente", () => {
        for (const t of [claro, oscuro]) {
            expect(contraste(t.text, t.bg)).toBeGreaterThanOrEqual(4.5);
            expect(contraste(t.text, t.surface)).toBeGreaterThanOrEqual(4.5);
        }
    });
});
