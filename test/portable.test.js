/* Banco portable .opios (task 8, F2.5): contenedor y gzip neutros (Uint8Array +
   CompressionStream), export/import sobre driver + almacén, y prueba cruzada Bun<->WASM. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { almacenBun } from "../src/almacen-bun.js";
import { crearAlmacenMemoria } from "../src/almacen-memoria.js";
import { abrirDb } from "../src/db.js";
import { abrirRepo } from "../src/db/index.js";
import { driverBun } from "../src/driver-bun.js";
import { crearDriverWasm } from "../src/driver-wasm.js";
import {
    comprimir,
    contenedor,
    descomprimir,
    descontenedor,
    exportarBanco,
    importarBancoOpios,
    FORMATO,
} from "../src/portable.js";
import { importarDirectorio } from "../src/seed.js";

const WASM = "node_modules/sql.js/dist/sql-wasm.wasm";
const driverWasm = crearDriverWasm({ rutaWasm: WASM });
const DIR_FIXTURE = join(import.meta.dir, "fixtures");

describe("banco portable .opios (task 8 / F2.5)", () => {
    test("contenedor y gzip de bajo nivel: ida y vuelta con cabecera y manifest", async () => {
        const manifest = { formato: FORMATO, app: "opios", nombre: "prueba" };
        const plano = contenedor(manifest, new Uint8Array([1, 2, 3]));
        expect([...plano.subarray(0, 12)]).toEqual([...new TextEncoder().encode("opios-banco\0")]);
        const leido = descontenedor(plano);
        expect(leido.manifest).toEqual(manifest);
        expect([...leido.sqlite]).toEqual([1, 2, 3]);

        const comprimido = await comprimir(plano);
        expect([...(await descomprimir(comprimido))]).toEqual([...plano]);
    });

    test("exportar e importar conserva preguntas y progreso (ida y vuelta, driver Bun)", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-portable-"));
        try {
            /* Banco con preguntas, progreso y simulacros. */
            const banco = join(dir, "banco.db");
            const repo = abrirDb(banco);
            await importarDirectorio(repo, DIR_FIXTURE);
            const pregunta = repo.todas()[0];
            repo.guardarProgreso([{ id: pregunta.id, caja: 3, vence: "2999-01-01", aciertos: 2, fallos: 1 }]);
            const paquete = await exportarBanco(driverBun, repo.db, { nombre: "Mi banco" });
            repo.close();

            expect(paquete.manifest).toMatchObject({
                formato: FORMATO,
                app: "opios",
                nombre: "Mi banco",
                preguntas: 7,
            });
            expect(paquete.bytes).toBeInstanceOf(Uint8Array);

            const restaurado = join(dir, "restaurado.db");
            const m2 = await importarBancoOpios(driverBun, almacenBun, restaurado, paquete.bytes);
            expect(m2).toMatchObject({ nombre: "Mi banco", preguntas: 7 });
            expect(existsSync(restaurado + ".tmp")).toBe(false); // no quedan temporales

            /* El banco restaurado es idéntico en contenido (VACUUM conserva ids y datos). */
            const repo1 = abrirDb(banco);
            const repo2 = abrirDb(restaurado);
            try {
                expect(repo2.todas()).toEqual(repo1.todas());
                expect(repo2.paraTest([1]).progreso[pregunta.id]).toEqual([3, "2999-01-01", 2, 1]);
            } finally {
                repo1.close();
                repo2.close();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("cruzado: exporta el WebView (wasm) y lo restaura el PC (bun), y al revés", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-portable-cruzado-"));
        try {
            /* Banco creado en el «WebView»: driver wasm + almacén en memoria. */
            const almacenM = crearAlmacenMemoria();
            const repoW = abrirRepo(await driverWasm.abrir(almacenM, "banco.db"));
            await importarDirectorio(repoW, DIR_FIXTURE);
            const deAndroid = await exportarBanco(driverWasm, repoW.db, { nombre: "De Android" });
            repoW.close();

            /* El PC lo restaura en disco y lo abre con Bun. */
            const enPc = join(dir, "de-android.db");
            expect(await importarBancoOpios(driverBun, almacenBun, enPc, deAndroid.bytes)).toMatchObject({
                nombre: "De Android",
                preguntas: 7,
            });
            const repoPc = abrirDb(enPc);
            expect(repoPc.contarPreguntas()).toBe(7);
            const dePc = await exportarBanco(driverBun, repoPc.db, { nombre: "De PC" });
            repoPc.close();

            /* Y el WebView importa el paquete del PC a su almacén. */
            expect(await importarBancoOpios(driverWasm, almacenM, "de-pc.db", dePc.bytes)).toMatchObject({
                nombre: "De PC",
                preguntas: 7,
            });
            const repoW2 = abrirRepo(await driverWasm.abrir(almacenM, "de-pc.db"));
            expect(repoW2.contarPreguntas()).toBe(7);
            repoW2.close();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test("rechaza: no-.opios, formato futuro y SQLite rota; el destino fallido no queda creado", async () => {
        const dir = mkdtempSync(join(tmpdir(), "opios-portable-malo-"));
        try {
            const banco = join(dir, "banco.db");
            abrirDb(banco).close();

            /* Un archivo cualquiera no es un .opios. */
            const falso = join(dir, "falso.opios");
            writeFileSync(falso, "no es un banco");
            await expect(
                importarBancoOpios(driverBun, almacenBun, join(dir, "x.db"), new Uint8Array(readFileSync(falso))),
            ).rejects.toThrow(/no es gzip|cabecera/);

            /* Formato futuro: cabecera correcta, manifest con formato mayor. */
            const futuro = await comprimir(contenedor({ formato: 99 }, new Uint8Array([0])));
            await expect(importarBancoOpios(driverBun, almacenBun, join(dir, "y.db"), futuro)).rejects.toThrow(
                /no soportado/,
            );

            /* SQLite truncada (integridad rota) no se restaura en silencio. */
            const repo = abrirDb(banco);
            const bueno = await exportarBanco(driverBun, repo.db, {});
            repo.close();
            const truncado = await comprimir((await descomprimir(bueno.bytes)).subarray(0, 100));
            await expect(importarBancoOpios(driverBun, almacenBun, join(dir, "z.db"), truncado)).rejects.toThrow();
            expect(existsSync(join(dir, "z.db"))).toBe(false); // el destino fallido no queda creado
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
