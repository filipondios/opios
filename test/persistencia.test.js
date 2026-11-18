/* F1.4: persistencia atómica del banco en Android (temporal + copia previa, debounce, recuperación). */
import { describe, expect, test } from "bun:test";
import { crearPersistencia } from "../src/android/persistencia.js";

const VALIDO = new Uint8Array([1, 2, 3]);
const CORRUPTO = new Uint8Array([9, 9, 9]);
const integro = (b) => b[0] === 1;

function almacenMemoria(inicial = {}) {
    const archivos = new Map(Object.entries(inicial));
    return {
        archivos,
        existe: async (p) => archivos.has(p),
        leer: async (p) => archivos.get(p),
        escribir: async (p, bytes) => archivos.set(p, bytes),
        renombrar: async (de, a) => {
            archivos.set(a, archivos.get(de));
            archivos.delete(de);
        },
        borrar: async (p) => {
            archivos.delete(p);
        },
    };
}

const persistir = (almacen, extra = {}) =>
    crearPersistencia({ almacen, ruta: "banco.db", exportar: () => VALIDO, integro, ...extra });

describe("persistencia Android (F1.4)", () => {
    test("guardar deja el canónico y rota la copia previa; no queda temporal", async () => {
        const almacen = almacenMemoria();
        let bytes = VALIDO;
        const p = crearPersistencia({ almacen, ruta: "banco.db", exportar: () => bytes, integro });

        p.cambios();
        await p.flush();
        expect([...almacen.archivos.get("banco.db")]).toEqual([1, 2, 3]);
        expect(almacen.archivos.has("banco.db.tmp")).toBe(false);

        bytes = new Uint8Array([1, 4]);
        p.cambios();
        await p.flush();
        expect([...almacen.archivos.get("banco.db")]).toEqual([1, 4]);
        expect([...almacen.archivos.get("banco.db.prev")]).toEqual([1, 2, 3]);
    });

    test("varios cambios seguidos se agrupan en un solo guardado (debounce)", async () => {
        const almacen = almacenMemoria();
        let escrituras = 0;
        const contador = {
            ...almacen,
            escribir: (p, b) => {
                escrituras++;
                return almacen.escribir(p, b);
            },
        };
        const p = persistir(contador, { retardo: 10 });
        p.cambios();
        p.cambios();
        p.cambios();
        await new Promise((r) => setTimeout(r, 40));
        expect(escrituras).toBe(1);
        expect(almacen.archivos.has("banco.db")).toBe(true);
    });

    test("abrir usa la copia previa si el canónico está corrupto y lo restaura", async () => {
        const almacen = almacenMemoria({ "banco.db": CORRUPTO, "banco.db.prev": VALIDO });
        const p = persistir(almacen);
        expect([...(await p.abrir())]).toEqual([1, 2, 3]);
        expect([...almacen.archivos.get("banco.db")]).toEqual([1, 2, 3]);
        expect(almacen.archivos.has("banco.db.prev")).toBe(false); // se consumió al restaurar
    });

    test("abrir: canónico válido gana; sin archivos o todo corrupto devuelve null", async () => {
        expect([...(await persistir(almacenMemoria({ "banco.db": VALIDO })).abrir())]).toEqual([1, 2, 3]);
        expect(await persistir(almacenMemoria()).abrir()).toBeNull();
        expect(await persistir(almacenMemoria({ "banco.db": CORRUPTO })).abrir()).toBeNull();
    });
});
