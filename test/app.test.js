import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirDb } from "../src/db.js";
import { crearApp } from "../src/app.js";
import { exportarPorBloques } from "../src/exportar.js";
import { importarDirectorio } from "../src/seed.js";
import { DIR_PREGUNTAS, CUPO_NUEVAS, FRENO_ATRASO } from "../src/config.js";
import { hoyIso, sumarDias } from "../src/fechas.js";
import { copiaSeguridad } from "../src/backup.js";

const DIR_FIXTURE = join(import.meta.dir, "fixtures");
const DIR_BLOQUES = join(import.meta.dir, "fixtures-bloques");
const TOTAL_TEMA_1 = 4;
const TOTAL_TEMA_2 = 3;
const TOTAL_FIXTURE = TOTAL_TEMA_1 + TOTAL_TEMA_2;

let repo, app;
const JSON_H = { "Content-Type": "application/json" };
const pet = (ruta, metodo = "GET", cuerpo) =>
  app(new Request("http://localhost" + ruta, { method: metodo, headers: cuerpo !== undefined ? JSON_H : {}, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined }));
const nueva = (o = {}) => ({ tema: 1, pregunta: "¿Capital de Francia?", respuestas: ["París", "Roma", "Lisboa"], correcta: 0, explicacion: "", ...o });
/** Crea un tema en el primer bloque (la migración v2 ya deja «Bloque 1»). Devuelve su id. */
const crearTemaPrueba = (numero = 1, nombre = null) => {
  const bloque = repo.temario().find((b) => b.id != null) ?? repo.crearBloque({ nombre: "Bloque 1" });
  return repo.crearTema({ bloque: bloque.id, numero, nombre }).id;
};

beforeEach(() => { repo = abrirDb(":memory:"); app = crearApp(repo); });

describe("importación de JSON", () => {
  test("importa la fixture, es idempotente y conserva la respuesta correcta", async () => {
    const r1 = await importarDirectorio(repo, DIR_FIXTURE);
    expect(r1.errores).toEqual([]);
    expect(r1.nuevas).toBe(TOTAL_FIXTURE);
    const r2 = await importarDirectorio(repo, DIR_FIXTURE);
    expect(r2.nuevas).toBe(0);
    expect(r2.duplicadas).toBe(TOTAL_FIXTURE);
    const orig = (await Bun.file(join(DIR_FIXTURE, "tema_1.json")).json())[0];
    const p = repo.listar({ tema: 1, texto: orig.pregunta }).items[0];
    expect(p.respuestas).toEqual(orig.respuestas);
    expect(p.correcta).toBe("abcdefgh".indexOf(orig.respuesta_correcta));
  });

  test("la deduplicación normaliza tildes, mayúsculas y puntuación", async () => {
    const dir = (await import("node:os")).tmpdir() + "/opios-dedupe-" + Date.now();
    const base = { tema: 1, pregunta: "¿Cuál es la capital de Francia?", respuestas: ["París", "Roma", "Lisboa"], respuesta_correcta: "a" };
    await Bun.write(join(dir, "tema_1.json"), JSON.stringify([
      base,
      { ...base, pregunta: "cual es la CAPITAL de francia" },
    ]));
    const r = await importarDirectorio(repo, dir);
    expect(r).toMatchObject({ nuevas: 1, duplicadas: 1 });
  });

  test("id_externo permite actualizar una pregunta conservando id y progreso", async () => {
    const dir = (await import("node:os")).tmpdir() + "/opios-id-externo-" + Date.now();
    const base = {
      pregunta: "Versión uno", respuestas: ["A", "B", "C"],
      respuesta_correcta: "b", explicacion: "vieja", id_externo: "ext-1",
    };
    await Bun.write(join(dir, "bloque_1/info.json"), JSON.stringify({ nombre: "Bloque de prueba", temas: [{ numero: 1, titulo: "Tema" }] }));
    await Bun.write(join(dir, "bloque_1/tema_1.json"), JSON.stringify([base]));

    const r1 = await importarDirectorio(repo, dir);
    expect(r1).toMatchObject({ nuevas: 1, actualizadas: 0 });
    const original = repo.todas()[0];
    repo.guardarProgreso([{ id: original.id, caja: 2, vence: "2999-01-01", aciertos: 1, fallos: 0 }]);

    await Bun.write(join(dir, "bloque_1/tema_1.json"), JSON.stringify([{
      ...base, pregunta: "Versión dos", respuestas: ["X", "Y", "Z"],
      respuesta_correcta: "c", explicacion: "nueva",
    }]));
    const r2 = await importarDirectorio(repo, dir, { actualizar: true });
    expect(r2).toMatchObject({ nuevas: 0, duplicadas: 0, actualizadas: 1 });

    const actualizada = repo.obtener(original.id);
    expect(actualizada).toMatchObject({
      id: original.id, pregunta: "Versión dos", respuestas: ["X", "Y", "Z"],
      correcta: 2, explicacion: "nueva", id_externo: "ext-1",
    });
    expect(repo.db.query("SELECT caja FROM progreso WHERE pregunta_id = ?").get(original.id).caja).toBe(2);
    expect(await (await pet("/api/exportar")).text()).toContain('"id_externo": "ext-1"');
  });

  test("avisa de opciones que dependen del orden al importar", async () => {
    const dir = (await import("node:os")).tmpdir() + "/opios-orden-" + Date.now();
    await Bun.write(join(dir, "bloque_1/info.json"), JSON.stringify({ nombre: "Bloque de prueba", temas: [{ numero: 1, titulo: "Tema" }] }));
    await Bun.write(join(dir, "bloque_1/tema_1.json"), JSON.stringify([
      { pregunta: "¿Cuál es correcta?", respuestas: ["Uno", "Dos", "Todas las anteriores"], respuesta_correcta: "c" },
      { pregunta: "¿Cuál no depende del orden?", respuestas: ["Todas las provincias", "Solo una", "Ninguna provincia"], respuesta_correcta: "a" },
    ]));
    const r = await importarDirectorio(repo, dir);
    expect(r.errores).toEqual([]);
    expect(r.avisos.filter((a) => a.includes("depender del orden")).length).toBe(1);
  });

  test("el banco real importa sin errores (smoke)", async () => {
    const r = await importarDirectorio(repo, DIR_PREGUNTAS);
    expect(r.errores).toEqual([]);
    expect(r.nuevas).toBeGreaterThan(0);
    const t = repo.temario();
    expect(t[0]).toMatchObject({ numero: 1, gestionado: true });
    expect(t[0].temas.length).toBeGreaterThanOrEqual(3);
  });

  test("exportar y reimportar da el mismo banco", async () => {
    await importarDirectorio(repo, DIR_FIXTURE);
    const txt = await (await pet("/api/exportar")).text();
    const otra = abrirDb(":memory:");
    const dir = (await import("node:os")).tmpdir() + "/opios-test-" + Date.now();
    await Bun.write(dir + "/x.json", txt);
    const r = await importarDirectorio(otra, dir);
    expect(r.errores).toEqual([]);
    expect(otra.todas()).toEqual(repo.todas().map((p) => ({ ...p, id: expect.any(Number) })));
  });
});

describe("importación por bloques", () => {
  test("lee info.json, crea bloques/temas, ignora generated y es idempotente", async () => {
    const r = await importarDirectorio(repo, DIR_BLOQUES);
    expect(r.errores).toEqual([]);
    expect(r.nuevas).toBe(5);

    const t = repo.temario();
    expect(t.map((b) => [b.numero, b.nombre, b.gestionado])).toEqual([
      [1, "Bloque I de prueba", true],
      [2, "Bloque II de prueba", true],
      [3, "Bloque 3", false],
    ]);
    expect(t[0].temas.map((x) => [x.numero, x.nombre])).toEqual([[1, "Tema uno"], [2, "Tema dos"]]);
    expect(t[1].temas.map((x) => x.numero)).toEqual([1, 2]);
    expect(t[1].temas.find((x) => x.numero === 2).preguntas).toBe(0);
    expect(t[2].gestionado).toBe(false);

    expect(repo.todas().some((p) => p.pregunta.includes("generated"))).toBe(false);
    expect(repo.todas().find((p) => p.pregunta.includes("Bloque II"))).toMatchObject({ bloque_numero: 2, tema_numero: 1 });

    const r2 = await importarDirectorio(repo, DIR_BLOQUES);
    expect(r2.nuevas).toBe(0);
    expect(r2.duplicadas).toBe(5);
  });

  test("rechaza una pregunta cuyo bloque declarado no coincide con la carpeta", async () => {
    const dir = (await import("node:os")).tmpdir() + "/opios-bloque-malo-" + Date.now();
    await Bun.write(dir + "/bloque_1/info.json", JSON.stringify({ nombre: "Bloque de prueba", temas: [] }));
    await Bun.write(dir + "/bloque_1/tema_1.json", JSON.stringify([{
      bloque: "Bloque 2", pregunta: "Pregunta mal ubicada", respuestas: ["A", "B"], respuesta_correcta: "a",
    }]));
    const r = await importarDirectorio(repo, dir);
    expect(r.errores.length).toBeGreaterThan(0);
    expect(r.nuevas).toBe(0);
  });

  test("info.json inválido (tema duplicado) se reporta y no crea el bloque gestionado", async () => {
    const dir = (await import("node:os")).tmpdir() + "/opios-bloque-info-" + Date.now();
    await Bun.write(dir + "/bloque_1/info.json", JSON.stringify({
      nombre: "Bloque inválido",
      temas: [{ numero: 1, titulo: "Uno" }, { numero: 1, titulo: "Otra vez uno" }],
    }));
    const r = await importarDirectorio(repo, dir);
    expect(r.errores.some((e) => e.includes("aparece dos veces"))).toBe(true);
    expect(repo.temario().find((b) => b.numero === 1).gestionado).toBe(false);
  });

  test("exportar por bloques y reimportar conserva bloques, títulos y preguntas", async () => {
    await importarDirectorio(repo, DIR_BLOQUES);
    const dir = (await import("node:os")).tmpdir() + "/opios-export-bloques-" + Date.now();
    const r = await exportarPorBloques(repo, dir);
    expect(r).toMatchObject({ bloques: 3, preguntas: 5, omitidas: 0 });

    const info = await Bun.file(join(dir, "bloque_1", "info.json")).json();
    expect(info).toEqual({
      nombre: "Bloque I de prueba",
      temas: [{ numero: 1, titulo: "Tema uno" }, { numero: 2, titulo: "Tema dos" }],
    });
    expect(await Bun.file(join(dir, "bloque_1", "tema_1.json")).exists()).toBe(true);

    const otra = abrirDb(":memory:");
    const imp = await importarDirectorio(otra, dir);
    expect(imp.errores).toEqual([]);
    expect(imp.nuevas).toBe(5);
    const t = otra.temario();
    expect(t.map((b) => [b.numero, b.nombre])).toEqual([
      [1, "Bloque I de prueba"], [2, "Bloque II de prueba"], [3, "Bloque 3"],
    ]);
    expect(t[0].temas.map((x) => [x.numero, x.nombre, x.preguntas])).toEqual([
      [1, "Tema uno", 2], [2, "Tema dos", 1],
    ]);
    expect(t[1].temas.find((x) => x.numero === 2).preguntas).toBe(0);
    otra.close();
  });

  test("el cliente del temario marca los bloques gestionados como solo lectura", async () => {
    const js = await (await pet("/js/temario.js")).text();
    expect(js).toContain("bloque.gestionado");
    expect(js).toContain("Solo lectura");
    expect(js).toContain("Definido en preguntas/bloque_");
  });

  test("un bloque gestionado por info.json es de solo lectura en la API", async () => {    await importarDirectorio(repo, DIR_BLOQUES);
    expect((await pet("/api/bloques/1", "PUT", { nombre: "Otro nombre" })).status).toBe(409);
    expect((await pet("/api/temas", "POST", { bloque: 1, numero: 9, nombre: "Nuevo" })).status).toBe(409);
    const tema = repo.temario()[0].temas[0];
    expect((await pet("/api/temas/" + tema.id, "PUT", { bloque: 1, numero: 9 })).status).toBe(409);
    expect((await pet("/api/temas/" + tema.id, "DELETE")).status).toBe(409);
    expect((await pet("/api/bloques/1", "DELETE")).status).toBe(409);

    const libre = repo.temario().find((b) => b.numero === 3);
    const r = await pet("/api/bloques/" + libre.id, "PUT", { nombre: "Bloque 3 renombrado" });
    expect(r.status).toBe(200);
    expect((await r.json()).numero).toBe(3);
  });
});

describe("API de preguntas", () => {
  beforeEach(() => {
    crearTemaPrueba(1);
    crearTemaPrueba(2);
  });

  test("crear, leer, editar y borrar", async () => {
    const c = await pet("/api/preguntas", "POST", nueva());
    expect(c.status).toBe(201);
    const p = await c.json();
    expect(p).toMatchObject({ tema: 1, correcta: 0, respuestas: ["París", "Roma", "Lisboa"] });
    const e = await pet("/api/preguntas/" + p.id, "PUT", nueva({ respuestas: ["Roma", "París"], correcta: 1, explicacion: "x" }));
    expect((await e.json())).toMatchObject({ respuestas: ["Roma", "París"], correcta: 1, explicacion: "x" });
    expect((await pet("/api/preguntas/" + p.id, "DELETE")).status).toBe(204);
    expect((await pet("/api/preguntas/" + p.id)).status).toBe(404);
    expect(repo.db.query("SELECT COUNT(*) n FROM opciones").get().n).toBe(0); // ON DELETE CASCADE
  });
  test("duplicados -> 409 con la pregunta existente", async () => {
    const p = await (await pet("/api/preguntas", "POST", nueva())).json();
    const r = await pet("/api/preguntas", "POST", nueva({ pregunta: "  ¿Capital   de Francia? " }));
    expect(r.status).toBe(409);
    expect((await r.json()).existente.id).toBe(p.id);
    /* La clave ignora tildes, mayúsculas y puntuación. */
    const r2 = await pet("/api/preguntas", "POST", nueva({ pregunta: "capital de francia" }));
    expect(r2.status).toBe(409);
    expect((await r2.json()).existente.id).toBe(p.id);
  });
  test("validación", async () => {
    for (const mala of [nueva({ tema: -1 }), nueva({ tema: "x" }), nueva({ pregunta: " " }), nueva({ respuestas: ["a"] }),
      nueva({ respuestas: ["a", "A"] }), nueva({ correcta: 5 }), nueva({ respuestas: ["a", ""] })])
      expect((await pet("/api/preguntas", "POST", mala)).status).toBe(400);
  });
  test("exige application/json y rechaza JSON roto", async () => {
    const r = await app(new Request("http://localhost/api/preguntas", { method: "POST", body: JSON.stringify(nueva()) }));
    expect(r.status).toBe(415);
    const r2 = await app(new Request("http://localhost/api/preguntas", { method: "POST", headers: JSON_H, body: "{" }));
    expect(r2.status).toBe(400);
  });
  test("listado con filtro, búsqueda y paginación", async () => {
    for (let i = 0; i < 5; i++) await pet("/api/preguntas", "POST", nueva({ tema: (i % 2) + 1, pregunta: "Pregunta número " + i }));
    expect((await (await pet("/api/preguntas?tema=1")).json()).total).toBe(3);
    expect((await (await pet("/api/preguntas?q=NÚMERO 4")).json()).items.length).toBe(1);
    const pag = await (await pet("/api/preguntas?limite=2&desde=2")).json();
    expect(pag.items.length).toBe(2); expect(pag.total).toBe(5);
    expect((await pet("/api/preguntas?limite=0")).status).toBe(400);
  });
  test("no crea temas implícitamente al guardar una pregunta", async () => {
    const r = await pet("/api/preguntas", "POST", nueva({ tema: 999 }));
    expect(r.status).toBe(404);
    expect(repo.db.query("SELECT COUNT(*) n FROM temas").get().n).toBe(2);
  });

  test("una sola opción correcta por pregunta (índice único parcial)", async () => {
    const p = await (await pet("/api/preguntas", "POST", nueva())).json();
    expect(() => repo.db.query("UPDATE opciones SET es_correcta = 1 WHERE pregunta_id = ?").run(p.id)).toThrow();
  });
});

describe("test y progreso", () => {
  beforeEach(async () => { await importarDirectorio(repo, DIR_FIXTURE); });

  test("/api/test devuelve preguntas del tema y su progreso", async () => {
    const d = await (await pet("/api/test?temas=2")).json();
    expect(d.preguntas.length).toBe(TOTAL_TEMA_2);
    expect(d.preguntas.every((q) => q.tema === 2 && q.respuestas.length >= 2 && q.correcta < q.respuestas.length)).toBe(true);
    expect(d.progreso).toEqual({});
    expect((await pet("/api/test")).status).toBe(400);
    expect((await pet("/api/test?temas=a")).status).toBe(400);
  });
  test("guardar progreso (upsert), verlo en /api/test y en las estadísticas, y reiniciarlo", async () => {
    const [a, b] = (await (await pet("/api/test?temas=1")).json()).preguntas;
    const r = await pet("/api/progreso", "POST", [
      { id: a.id, caja: 5, vence: "2999-01-01", aciertos: 3, fallos: 0 },
      { id: b.id, caja: 0, vence: hoyIso(), aciertos: 0, fallos: 1 }]);
    expect(r.status).toBe(200);
    await pet("/api/progreso", "POST", [{ id: b.id, caja: 1, vence: "2999-01-01", aciertos: 1, fallos: 1 }]);
    const d = await (await pet("/api/test?temas=1")).json();
    expect(d.progreso[a.id]).toEqual([5, "2999-01-01", 3, 0]);
    expect(d.progreso[b.id]).toEqual([1, "2999-01-01", 1, 1]);
    const t1 = repo.estadisticasTemas(hoyIso(), 4).find((t) => t.tema === 1);
    expect(t1).toMatchObject({ total: TOTAL_TEMA_1, nuevas: TOTAL_TEMA_1 - 2, dominadas: 1, aprendiendo: 1, repaso: 0 });
    const html = await (await pet("/")).text();
    expect(html).toContain(`data-tema="1"`);
    expect(html).toContain(`data-nuevas="${TOTAL_TEMA_1 - 2}"`);
    await pet("/api/progreso", "DELETE");
    expect((await (await pet("/api/test?temas=1")).json()).progreso).toEqual({});
  });
  test("progreso inválido o de preguntas inexistentes", async () => {
    expect((await pet("/api/progreso", "POST", [{ id: 1, caja: 9, vence: "2999-01-01", aciertos: 0, fallos: 0 }])).status).toBe(400);
    expect((await pet("/api/progreso", "POST", [{ id: 1, caja: 1, vence: "mañana", aciertos: 0, fallos: 0 }])).status).toBe(400);
    expect((await pet("/api/progreso", "POST", [{ id: 99999, caja: 1, vence: "2999-01-01", aciertos: 0, fallos: 0 }])).status).toBe(200);
    expect(repo.db.query("SELECT COUNT(*) n FROM progreso").get().n).toBe(0);
  });
  test("borrar una pregunta borra su progreso; editarla lo conserva", async () => {
    const p = (await (await pet("/api/test?temas=1")).json()).preguntas[0];
    await pet("/api/progreso", "POST", [{ id: p.id, caja: 2, vence: "2999-01-01", aciertos: 2, fallos: 0 }]);
    await pet("/api/preguntas/" + p.id, "PUT", nueva({ tema: 1, pregunta: "Enunciado editado" }));
    expect(repo.db.query("SELECT caja FROM progreso WHERE pregunta_id = ?").get(p.id).caja).toBe(2);
    await pet("/api/preguntas/" + p.id, "DELETE");
    expect(repo.db.query("SELECT COUNT(*) n FROM progreso").get().n).toBe(0);
  });
});

describe("páginas y estáticos", () => {
  test("home vacía y con datos; navegación entre páginas", async () => {
    let html = await (await pet("/")).text();
    expect(html).toContain("Todavía no hay preguntas");
    expect(html).toContain('href="/maker"');
    await importarDirectorio(repo, DIR_FIXTURE);
    html = await (await pet("/")).text();
    expect(html).toContain('data-tema="1"'); expect(html).toContain('data-tema="2"');
    expect(html).toContain('href="/maker"'); expect(html).toContain("/js/test.js");
    expect(html).toContain('type="module"');
    const m = await (await pet("/maker")).text();
    expect(m).toContain('href="/"'); expect(m).toContain("Test"); expect(m).toContain("/js/maker.js");
    const t = await (await pet("/temario")).text();
    expect(t).toContain("/js/temario.js"); expect(t).toContain("Nuevo bloque");
    expect((await pet("/fragmentos/temas")).status).toBe(200);
  });
  test("las plantillas escapan HTML", async () => {
    const b = await (await pet("/api/bloques", "POST", { nombre: "Bloque X" })).json();
    const t = await (await pet("/api/temas", "POST", { bloque: b.id, numero: 1, nombre: "<script>alert(1)</script>" })).json();
    await pet("/api/preguntas", "POST", nueva({ tema: t.id }));
    const html = await (await pet("/")).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });
  test("estáticos y path traversal", async () => {
    for (const f of ["/css/base.css", "/css/test.css", "/css/maker.css", "/css/temario.css", "/css/estadisticas.css", "/css/simulacro.css", "/js/test.js", "/js/repaso.js", "/js/etiquetas.js", "/js/resultado.js", "/js/maker.js", "/js/temario.js", "/js/simulacro.js", "/js/tema.js", "/logo.png"]) expect((await pet(f)).status).toBe(200);
    expect((await pet("/../server.js")).status).toBe(404);
    expect((await pet("/%2e%2e/server.js")).status).toBe(404);
    expect((await pet("/nada.js")).status).toBe(404);
  });
});

describe("interfaz, accesibilidad y tema", () => {
  test("todas las páginas comparten el mismo menú y marcan la activa", async () => {
    await importarDirectorio(repo, DIR_FIXTURE);
    const casos = [
      ["/", "Test"],
      ["/simulacro", "Simulacro"],
      ["/estadisticas", "Estadísticas"],
      ["/maker", "Maker"],
      ["/temario", "Temario"],
    ];
    for (const [ruta, texto] of casos) {
      const r = await pet(ruta);
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toContain('aria-label="Principal"');
      expect(html).toContain(`<a href="${ruta}" aria-current="page">${texto}</a>`);
      for (const href of ["/", "/simulacro", "/estadisticas", "/maker", "/temario"]) {
        expect(html).toContain(`href="${href}"`);
      }
    }
  });

  test("conmutador de tema: botón, persistencia y CSS de modo oscuro", async () => {
    const html = await (await pet("/")).text();
    expect(html).toContain('id="btn-tema"');
    expect(html).toContain("/js/tema.js");
    expect(html).toContain('localStorage.getItem("opios.tema")');
    const js = await (await pet("/js/tema.js")).text();
    expect(js).toContain('localStorage.setItem(CLAVE');
    expect(js).toContain("prefers-color-scheme: dark");
    const css = await (await pet("/css/base.css")).text();
    expect(css).toContain(':root[data-theme="dark"]');
  });

  test("favicon y 404 HTML", async () => {
    const home = await (await pet("/")).text();
    expect(home).toContain('href="/logo.png"');
    const fav = await pet("/logo.png");
    expect(fav.status).toBe(200);
    expect(fav.headers.get("content-type")).toContain("image/png");
    const firma = new Uint8Array(await fav.arrayBuffer()).slice(0, 8);
    expect([...firma]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const r = await pet("/ruta-que-no-existe");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("Página no encontrada");
    expect(html).toContain("ruta-que-no-existe");
    expect(html).toContain('href="/temario"');
  });

  test("opciones con radios reales y sin diálogos nativos", async () => {
    const testJs = await (await pet("/js/test.js")).text();
    expect(testJs).toContain('type: "radio"');
    expect(testJs).toContain('name: "opcion"');
    expect(testJs).not.toContain('role: "radio"');

    const simJs = await (await pet("/js/simulacro.js")).text();
    expect(simJs).toContain('type: "radio"');
    expect(simJs).toContain('name: "exam-opcion"');
    expect(simJs).not.toContain('aria-pressed');
    expect(simJs).not.toContain("window.confirm(");
    expect(simJs).toContain("confirmarAccion");

    const simHtml = await (await pet("/simulacro")).text();
    expect(simHtml).toContain('role="radiogroup"');
    expect(simHtml).toContain('id="dlg-confirm"');
    expect(simHtml).toContain('id="dlg-confirm-msg"');
  });

  test("primer toque configurable y ayuda de teclas dinámica", async () => {
    await importarDirectorio(repo, DIR_FIXTURE);
    const html = await (await pet("/")).text();
    expect(html).toContain('id="cfg-un-toque"');
    expect(html).toContain('id="keys-opts"');
    expect(html).not.toContain("<kbd>A</kbd>–<kbd>D</kbd>");
    const js = await (await pet("/js/test.js")).text();
    expect(js).toContain("ti.una-pulsacion");
    expect(js).toContain("unaPulsacion");
    expect(js).toContain("pintarAyudaTeclas");
  });
});

describe("fecha inyectada", () => {
  test("crearApp usa `ahora` para calcular los repasos de hoy", async () => {
    crearTemaPrueba(1);
    const p = await (await pet("/api/preguntas", "POST", nueva({ tema: 1, pregunta: "Pregunta con fecha inyectada" }))).json();
    await pet("/api/progreso", "POST", [{ id: p.id, caja: 4, vence: "2000-01-01", aciertos: 0, fallos: 0 }]);

    const conFecha = crearApp(repo, { ahora: () => new Date(2000, 0, 1) });
    const html = await (await conFecha(new Request("http://localhost/"))).text();
    expect(html).toContain('data-repaso="1"');
    expect(html).toContain("1 por repasar hoy");

    const antes = crearApp(repo, { ahora: () => new Date(1999, 11, 31) });
    const htmlAntes = await (await antes(new Request("http://localhost/"))).text();
    expect(htmlAntes).toContain('data-repaso="0"');
  });

  test("la zona APP_TZ decide el día aunque el servidor esté en UTC", async () => {
    crearTemaPrueba(1);
    const p = await (await pet("/api/preguntas", "POST", nueva({ tema: 1, pregunta: "Pregunta de medianoche" }))).json();
    await pet("/api/progreso", "POST", [{ id: p.id, caja: 2, vence: "2026-03-11", aciertos: 0, fallos: 0 }]);

    // 23:30 UTC del día 10 = 00:30 del día 11 en Madrid.
    const ahora = () => new Date("2026-03-10T23:30:00Z");
    const madrid = crearApp(repo, { ahora, zona: "Europe/Madrid" });
    const htmlMadrid = await (await madrid(new Request("http://localhost/"))).text();
    expect(htmlMadrid).toContain('data-repaso="1"');

    const utc = crearApp(repo, { ahora, zona: "UTC" });
    const htmlUtc = await (await utc(new Request("http://localhost/"))).text();
    expect(htmlUtc).toContain('data-repaso="0"');
  });
});

describe("temario por bloques", () => {
  beforeEach(async () => { await importarDirectorio(repo, DIR_FIXTURE); });

  test("la primera importación crea el bloque 1 con los temas numerados", async () => {
    const t = await (await pet("/api/temario")).json();
    const b1 = t.find((b) => b.id === 1);
    expect(b1.nombre).toBe("Bloque 1");
    expect(b1.temas.map((x) => x.numero)).toEqual([1, 2]);
  });

  test("crear bloques y temas, con validaciones", async () => {
    const b = await (await pet("/api/bloques", "POST", { nombre: "Bloque 2" })).json();
    expect(b).toMatchObject({ id: 2, nombre: "Bloque 2", orden: 1 });
    expect((await pet("/api/bloques", "POST", { nombre: "Bloque 2" })).status).toBe(409);
    expect((await pet("/api/bloques", "POST", { nombre: " " })).status).toBe(400);

    const t = await (await pet("/api/temas", "POST", { bloque: b.id, numero: 1, nombre: "Hardware" })).json();
    expect(t).toMatchObject({ bloque: 2, numero: 1, nombre: "Hardware", preguntas: 0 });
    expect((await pet("/api/temas", "POST", { bloque: b.id, numero: 1 })).status).toBe(409);
    expect((await pet("/api/temas", "POST", { bloque: 999, numero: 2 })).status).toBe(404);
    expect((await pet("/api/temas", "POST", { bloque: b.id, numero: -1 })).status).toBe(400);
  });

  test("renombrar, reordenar y borrar bloques; borrar temas", async () => {
    const b = await (await pet("/api/bloques", "POST", { nombre: "Bloque 2" })).json();
    expect((await (await pet("/api/bloques/" + b.id, "PUT", { nombre: "Bloque II" })).json()).nombre).toBe("Bloque II");
    expect((await pet("/api/bloques/reordenar", "POST", { ids: [b.id, 1] })).status).toBe(200);
    expect((await (await pet("/api/temario")).json()).map((x) => x.nombre)).toEqual(["Bloque II", "Bloque 1"]);

    const t = await (await pet("/api/temas", "POST", { bloque: b.id, numero: 1 })).json();
    expect((await pet("/api/bloques/" + b.id, "DELETE")).status).toBe(409);
    expect((await pet("/api/temas/" + t.id, "DELETE")).status).toBe(204);
    expect((await pet("/api/bloques/" + b.id, "DELETE")).status).toBe(204);
    expect((await pet("/api/bloques/reordenar", "POST", { ids: [999] })).status).toBe(400);
  });

  test("las preguntas heredan el bloque y el número de tema", async () => {
    const b = await (await pet("/api/bloques", "POST", { nombre: "Bloque 2" })).json();
    const t = await (await pet("/api/temas", "POST", { bloque: b.id, numero: 3, nombre: "Redes" })).json();
    const p = await (await pet("/api/preguntas", "POST", nueva({ tema: t.id }))).json();
    expect(p).toMatchObject({ tema: t.id, tema_numero: 3, bloque: 2, bloque_nombre: "Bloque 2" });
    const d = await (await pet("/api/test?temas=" + t.id)).json();
    expect(d.preguntas[0]).toMatchObject({ tema_numero: 3, bloque_nombre: "Bloque 2" });
    expect((await (await pet("/api/temas")).json()).find((x) => x.tema === t.id).total).toBe(1);
  });

  test("la portada agrupa los temas por bloque y el creador los ofrece en optgroups", async () => {
    const b = await (await pet("/api/bloques", "POST", { nombre: "Bloque 2" })).json();
    const t = await (await pet("/api/temas", "POST", { bloque: b.id, numero: 1, nombre: "Hardware" })).json();
    await pet("/api/preguntas", "POST", nueva({ tema: t.id, pregunta: "¿Qué es la memoria RAM?" }));
    const home = await (await pet("/")).text();
    expect(home).toContain("bloque-head");
    expect(home).toContain("sel-bloque");
    expect(home).toContain("Bloque 2");
    const maker = await (await pet("/maker")).text();
    expect(maker).toContain("<optgroup");
    expect(maker).toContain("Hardware");
  });

  test("las etiquetas largas se recortan en los desplegables", async () => {
    const largo = "Un nombre de tema extraordinariamente largo que no cabe en el desplegable";
    const b = await (await pet("/api/bloques", "POST", { nombre: "Bloque 2" })).json();
    await pet("/api/temas", "POST", { bloque: b.id, numero: 1, nombre: largo });
    const maker = await (await pet("/maker")).text();
    expect(maker).toContain("...");
    expect(maker).not.toContain(largo);
  });

  test("exportar y reimportar conserva los bloques", async () => {
    const b = await (await pet("/api/bloques", "POST", { nombre: "Bloque 2" })).json();
    const t = await (await pet("/api/temas", "POST", { bloque: b.id, numero: 1, nombre: "Hardware" })).json();
    await pet("/api/preguntas", "POST", nueva({ tema: t.id, pregunta: "¿Cuál de estos es un periférico de entrada?" }));
    const txt = await (await pet("/api/exportar")).text();
    const otra = abrirDb(":memory:");
    const dir = (await import("node:os")).tmpdir() + "/opios-test-bloques-" + Date.now();
    await Bun.write(dir + "/x.json", txt);
    const r = await importarDirectorio(otra, dir);
    expect(r.errores).toEqual([]);
    expect(otra.temario().find((x) => x.nombre === "Bloque 2").temas[0]).toMatchObject({ numero: 1, preguntas: 1 });
    expect(otra.todas().find((p) => p.bloque_nombre === "Bloque 2")).toMatchObject({ tema_numero: 1 });
  });
});

describe("estadísticas y simulacros", () => {
  beforeEach(async () => {
    crearTemaPrueba(1);
    for (let i = 0; i < 3; i++)
      await pet("/api/preguntas", "POST", nueva({ tema: 1, pregunta: "Pregunta simulacro " + i, respuestas: ["A", "B", "C", "D"], correcta: i % 4 }));
  });

  const conProgreso = async () => {
    const bank = (await (await pet("/api/test?temas=1")).json()).preguntas;
    await pet("/api/progreso", "POST", [
      { id: bank[0].id, caja: 5, vence: "2999-01-01", aciertos: 4, fallos: 1 },
      { id: bank[1].id, caja: 0, vence: hoyIso(), aciertos: 0, fallos: 3 },
    ]);
    return bank;
  };

  test("la página de estadísticas refleja progreso y fallos; sin datos muestra aviso", async () => {
    let html = await (await pet("/estadisticas")).text();
    expect(html).toContain("Todavía no hay actividad registrada");
    expect(html).toContain('href="/simulacro"');
    await conProgreso();
    html = await (await pet("/estadisticas")).text();
    expect(html).not.toContain("Todavía no hay actividad registrada");
    expect(html).toContain("Pregunta simulacro 1"); // la más fallada
    expect(html).toContain("50 %"); // precision 4/8
  });

  test("el cliente envía el índice original al guardar (opciones barajadas)", async () => {
    const { respuestasParaGuardar } = await import("../public/js/simulacro-logica.js");
    expect(respuestasParaGuardar([{ id: 7, originales: [2, 0, 1] }], [2]))
      .toEqual([{ id: 7, elegida: 1 }]);
  });

  test("el aviso distingue entre sin actividad y solo simulacros", async () => {
    const bank = (await (await pet("/api/test?temas=1")).json()).preguntas;
    await pet("/api/simulacros", "POST", {
      temas: [1], segundos: 10, penalizacion: 0,
      respuestas: [{ id: bank[0].id, elegida: bank[0].correcta }],
    });
    const html = await (await pet("/estadisticas")).text();
    expect(html).toContain("Todavía no has hecho ningún test");
    expect(html).toContain("1 simulacro registrado");
    expect(html).not.toContain("Todavía no hay actividad registrada");
  });

  test("/simulacro ofrece la configuración del examen", async () => {
    const html = await (await pet("/simulacro")).text();
    expect(html).toContain('id="btn-empezar"');
    expect(html).toContain('id="cfg-pen"');
    expect(html).toContain("/js/simulacro.js");
  });

  test("la opción de penalización usa 1/3 exacto", async () => {
    const html = await (await pet("/simulacro")).text();
    expect(html).toContain('value="0.3333333333333333"');
    expect(html).not.toContain('value="0.3333"');
  });

  test("el simulacro se guarda en localStorage y se puede reanudar", async () => {
    const html = await (await pet("/simulacro")).text();
    expect(html).toContain('id="btn-reanudar"');
    expect(html).toContain('id="btn-descartar"');
    const js = await (await pet("/js/simulacro.js")).text();
    expect(js).toContain("opios.simulacro.curso");
    expect(js).toContain("opios.simulacro.pendiente");
    expect(js).toContain("crypto?.randomUUID");
    expect(js).toContain("clave_idempotencia");
  });

  test("la tabla de simulacros resuelve el id del tema a su número y bloque", async () => {
    const b = await (await pet("/api/bloques", "POST", { nombre: "Bloque 2" })).json();
    const t = await (await pet("/api/temas", "POST", { bloque: b.id, numero: 7, nombre: "Tema siete" })).json();
    const p = await (await pet("/api/preguntas", "POST", nueva({ tema: t.id, pregunta: "Pregunta del tema siete" }))).json();
    await pet("/api/simulacros", "POST", {
      temas: [t.id], segundos: 10, penalizacion: 0,
      respuestas: [{ id: p.id, elegida: p.correcta }],
    });
    const html = await (await pet("/estadisticas")).text();
    expect(html).toContain("Bloque 2 · Tema 7 — Tema siete");
    expect(html).not.toContain(`<td>Tema ${t.id}</td>`);
  });

  test("guardar un simulacro recalcula el resultado y se puede listar y ver en detalle", async () => {
    const bank = await conProgreso();
    const r = await pet("/api/simulacros", "POST", {
      temas: [1], segundos: 600, penalizacion: 1 / 3,
      respuestas: [
        { id: bank[0].id, elegida: bank[0].correcta },
        { id: bank[1].id, elegida: (bank[1].correcta + 1) % 4 },
        { id: bank[2].id, elegida: -1 },
      ],
    });
    expect(r.status).toBe(201);
    const s = await r.json();
    expect(s).toMatchObject({ temas: [1], total: 3, aciertos: 1, fallos: 1, en_blanco: 1, segundos: 600 });
    expect(s.puntos).toBeCloseTo(2 / 3, 2);

    expect((await (await pet("/api/simulacros")).json()).length).toBe(1);
    const uno = await (await pet("/api/simulacros/" + s.id)).json();
    expect(uno.detalle).toEqual([
      { id: bank[0].id, elegida: bank[0].correcta, correcta: bank[0].correcta },
      { id: bank[1].id, elegida: (bank[1].correcta + 1) % 4, correcta: bank[1].correcta },
      { id: bank[2].id, elegida: null, correcta: bank[2].correcta },
    ]);
    const html = await (await pet("/estadisticas")).text();
    expect(html).toContain("10:00"); // 600 s en la tabla de simulacros
  });

  test("las preguntas falladas incluyen los fallos de simulacros aunque no haya tests", async () => {
    const bank = (await (await pet("/api/test?temas=1")).json()).preguntas;
    await pet("/api/simulacros", "POST", {
      temas: [1], segundos: 20, penalizacion: 0,
      respuestas: [
        { id: bank[0].id, elegida: (bank[0].correcta + 1) % bank[0].respuestas.length },
        { id: bank[1].id, elegida: bank[1].correcta },
        { id: bank[2].id, elegida: -1 },
      ],
    });
    const html = await (await pet("/estadisticas")).text();
    expect(html).not.toContain("Todavía no hay fallos registrados");
    expect(html).toContain(bank[0].pregunta);
    expect(html).not.toContain(bank[1].pregunta); // acertada: no entra en la tabla
    expect(html).not.toContain(bank[2].pregunta); // en blanco: tampoco
    expect(repo.preguntasMasFalladas(20)).toEqual([
      expect.objectContaining({ id: bank[0].id, fallos: 1, aciertos: 0, caja: 1 }),
    ]);
  });

  test("los fallos del simulacro bajan 2 cajas; los aciertos solo suman y los blancos no tocan", async () => {
    const bank = (await (await pet("/api/test?temas=1")).json()).preguntas;
    await pet("/api/progreso", "POST", [
      { id: bank[0].id, caja: 6, vence: "2999-01-01", aciertos: 5, fallos: 0 },
    ]);
    await pet("/api/simulacros", "POST", {
      temas: [1], segundos: 20, penalizacion: 0,
      respuestas: [
        { id: bank[0].id, elegida: (bank[0].correcta + 1) % bank[0].respuestas.length }, // fallo
        { id: bank[1].id, elegida: bank[1].correcta }, // acierto sin progreso
        { id: bank[2].id, elegida: -1 }, // en blanco
      ],
    });
    const progreso = repo.paraTest([1]).progreso;
    expect(progreso[bank[0].id]).toEqual([4, hoyIso(), 5, 1]);
    expect(progreso[bank[1].id]).toBeUndefined();
    expect(progreso[bank[2].id]).toBeUndefined();
  });

  test("el acierto de simulacro suma el contador sin mover caja ni fecha", async () => {
    const bank = (await (await pet("/api/test?temas=1")).json()).preguntas;
    await pet("/api/progreso", "POST", [
      { id: bank[0].id, caja: 3, vence: "2999-01-01", aciertos: 2, fallos: 1 },
    ]);
    await pet("/api/simulacros", "POST", {
      temas: [1], segundos: 20, penalizacion: 0,
      respuestas: [{ id: bank[0].id, elegida: bank[0].correcta }],
    });
    expect(repo.paraTest([1]).progreso[bank[0].id]).toEqual([3, "2999-01-01", 3, 1]);
  });

  test("el POST de simulacro es idempotente con la misma clave", async () => {
    const bank = (await (await pet("/api/test?temas=1")).json()).preguntas;
    const cuerpo = {
      temas: [1], segundos: 20, penalizacion: 0, clave_idempotencia: "prueba-idempotente-1",
      respuestas: [{ id: bank[0].id, elegida: (bank[0].correcta + 1) % bank[0].respuestas.length }],
    };
    const a = await (await pet("/api/simulacros", "POST", cuerpo)).json();
    const b = await (await pet("/api/simulacros", "POST", cuerpo)).json();
    expect(b.id).toBe(a.id);
    expect(repo.contarSimulacros()).toBe(1);
    expect(repo.paraTest([1]).progreso[bank[0].id][3]).toBe(1); // no se cuenta dos veces
  });

  test("la penalización de 1/3 resta exactamente un punto por cada tres fallos", async () => {
    const bank = (await (await pet("/api/test?temas=1")).json()).preguntas;
    const r = await pet("/api/simulacros", "POST", {
      temas: [1], segundos: 20, penalizacion: 1 / 3,
      respuestas: bank.slice(0, 3).map((q) => ({
        id: q.id, elegida: (q.correcta + 1) % q.respuestas.length,
      })),
    });
    const s = await r.json();
    expect(s).toMatchObject({ aciertos: 0, fallos: 3 });
    expect(s.puntos).toBe(-1);
  });

  test("los fallos de test y simulacro se suman en la misma pregunta", async () => {
    const bank = await conProgreso();
    await pet("/api/simulacros", "POST", {
      temas: [1], segundos: 20, penalizacion: 0,
      respuestas: [{ id: bank[1].id, elegida: (bank[1].correcta + 1) % bank[1].respuestas.length }],
    });
    const fila = repo.preguntasMasFalladas(20).find((p) => p.id === bank[1].id);
    expect(fila).toMatchObject({ fallos: 4, aciertos: 0, caja: 1 }); // 3 del test + 1 del simulacro
  });

  test("simulacro inválido o con preguntas inexistentes", async () => {
    const bank = await conProgreso();
    const cuerpo = (o = {}) => ({ temas: [1], segundos: 1, penalizacion: 0, respuestas: [{ id: bank[0].id, elegida: 0 }], ...o });
    for (const mala of [
      cuerpo({ temas: [] }), cuerpo({ temas: "x" }), cuerpo({ segundos: -1 }), cuerpo({ penalizacion: 2 }),
      cuerpo({ respuestas: [] }), cuerpo({ respuestas: [{ id: 0, elegida: 0 }] }),
      cuerpo({ respuestas: [{ id: bank[0].id, elegida: 9 }] }),
      cuerpo({ respuestas: [{ id: bank[0].id, elegida: 0 }, { id: bank[0].id, elegida: 1 }] }),
    ]) expect((await pet("/api/simulacros", "POST", mala)).status).toBe(400);
    expect((await pet("/api/simulacros", "POST", { temas: [1], segundos: 1, penalizacion: 0, respuestas: [{ id: 99999, elegida: 0 }] })).status).toBe(400);
    expect((await pet("/api/simulacros/99999")).status).toBe(404);
  });
});

describe("etiquetas y resultados del cliente", () => {
  test("la etiqueta de tema es la misma en servidor y cliente", async () => {
    const { etiquetaTema } = await import("../src/etiquetas.js");
    const { etiquetaTema: enCliente } = await import("../public/js/etiquetas.js");
    const casos = [
      { numero: 3, nombre: "Redes", bloque_nombre: "Bloque II" },
      { tema: 5, tema_numero: 2, tema_nombre: "Hardware", bloque_nombre: "Bloque I" },
      { tema_numero: 1 },
      { id: 9, numero: 7 },
    ];
    for (const c of casos) expect(enCliente(c)).toBe(etiquetaTema(c));
    expect(etiquetaTema(casos[0])).toBe("Bloque II · Tema 3 — Redes");
    expect(etiquetaTema(casos[0], { bloque: false })).toBe("Tema 3 — Redes");
    expect(etiquetaTema(casos[1], { nombre: false })).toBe("Bloque I · Tema 2");
  });

  test("el desglose del simulacro agrupa por id de tema, no por número", async () => {
    const { calcularResultado } = await import("../public/js/resultado.js");
    const preguntas = [
      { tema: 10, temaNumero: 1, temaNombre: "Uno del bloque I", bloque: "Bloque I", correcta: 0 },
      { tema: 20, temaNumero: 1, temaNombre: "Uno del bloque II", bloque: "Bloque II", correcta: 1 },
      { tema: 20, temaNumero: 1, temaNombre: "Uno del bloque II", bloque: "Bloque II", correcta: 2 },
    ];
    const res = calcularResultado(preguntas, [0, 0, 2], 0, 30);
    expect(res).toMatchObject({ total: 3, aciertos: 2, fallos: 1, blancos: 0 });
    expect(res.porTema).toHaveLength(2);
    expect(res.porTema.map((t) => [t.tema, t.numero, t.total, t.aciertos, t.fallos])).toEqual([
      [10, 1, 1, 1, 0],
      [20, 1, 2, 1, 1],
    ]);
  });

  test("tres fallos con penalización 1/3 restan exactamente un punto", async () => {
    const { calcularResultado } = await import("../public/js/resultado.js");
    const preguntas = [0, 1, 2].map(() => ({ tema: 1, temaNumero: 1, correcta: 0 }));
    const res = calcularResultado(preguntas, [1, 1, 1], 1 / 3, 10);
    expect(res.fallos).toBe(3);
    expect(res.puntos).toBe(-1);
  });

  test("los límites de la interfaz salen de la configuración, no van escritos a mano", async () => {
    const html = await (await pet("/temario")).text();
    expect(html).toContain('data-max-bloque="120"');
    expect(html).toContain('data-max-tema="500"');
    const js = await (await pet("/js/temario.js")).text();
    expect(js).toContain("maxlength: MAX_BLOQUE");
    expect(js).toContain("maxlength: MAX_TEMA_NOMBRE");
    expect(js).not.toContain("maxlength: 120");
    expect(js).not.toContain("maxlength: 200");
  });
});

describe("copia de seguridad", () => {
  test("VACUUM INTO conserva preguntas, progreso y simulacros", async () => {
    crearTemaPrueba(1);
    const p = await (await pet("/api/preguntas", "POST", nueva({ tema: 1 }))).json();
    await pet("/api/progreso", "POST", [{ id: p.id, caja: 3, vence: "2999-01-01", aciertos: 2, fallos: 1 }]);
    await pet("/api/simulacros", "POST", {
      temas: [1], segundos: 10, penalizacion: 0,
      respuestas: [{ id: p.id, elegida: p.correcta }],
    });

    const dir = mkdtempSync(join(tmpdir(), "opios-backup-"));
    const destino = join(dir, "copia.db");
    try {
      copiaSeguridad(repo.db, destino);
      const otra = abrirDb(destino);
      expect(otra.contarPreguntas()).toBe(1);
      expect(otra.contarSimulacros()).toBe(1);
      expect(otra.paraTest([1]).progreso[p.id]).toEqual([3, "2999-01-01", 3, 1]);
      otra.close();
      expect(() => copiaSeguridad(repo.db, destino)).toThrow(/Ya existe/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("registro de respuestas, estadísticas y carga diaria", () => {
  beforeEach(async () => { await importarDirectorio(repo, DIR_FIXTURE); });
  const ids = async (tema = 1) => (await (await pet("/api/test?temas=" + tema)).json()).preguntas.map((p) => p.id);
  const carga = async () => (await pet("/api/carga")).json();

  test("la migración crea la tabla respuestas con sus índices", () => {
    expect(repo.db.query("PRAGMA user_version").get().user_version).toBe(11);
    expect(repo.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='respuestas'").get()).toBeTruthy();
    const indices = repo.db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='respuestas'").all().map((r) => r.name);
    expect(indices).toContain("idx_respuestas_fecha");
    expect(indices).toContain("idx_respuestas_pregunta");
    const columnas = repo.db.query("PRAGMA table_info(preguntas)").all().map((r) => r.name);
    expect(columnas).toContain("clave_norm");
    expect(columnas).toContain("id_externo");
    expect(columnas).not.toContain("clave");
    const indicesPreguntas = repo.db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='preguntas'").all().map((r) => r.name);
    expect(indicesPreguntas).toContain("ux_preguntas_clave_norm");
    expect(indicesPreguntas).toContain("ux_preguntas_id_externo");
    expect(repo.db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  test("POST /api/respuestas guarda el lote y alimenta la actividad", async () => {
    const [a, b] = await ids();
    const r = await pet("/api/respuestas", "POST", { respuestas: [
      { id: a, acierto: true, ms: 1500 },
      { id: b, acierto: false, ms: 2500 },
    ] });
    expect(r.status).toBe(201);
    expect((await r.json()).registradas).toBe(2);
    const act = await repo.actividadReciente(sumarDias(hoyIso(), -13));
    expect(act.at(-1)).toMatchObject({ dia: hoyIso(), n: 2, aciertos: 1, fallos: 1 });
    expect(repo.tiempoMedio()).toEqual({ ms: 2000, n: 2 });
  });

  test("el lote se valida y admite también un array directo", async () => {
    const [a] = await ids();
    for (const malo of [
      {}, { respuestas: [] }, { respuestas: [{ id: 0, acierto: true }] },
      { respuestas: [{ id: a, acierto: "sí" }] }, { respuestas: [{ id: a, acierto: true, ms: -5 }] },
      { respuestas: [{ id: a, acierto: true, ms: 99999999 }] },
    ]) expect((await pet("/api/respuestas", "POST", malo)).status).toBe(400);
    expect((await pet("/api/respuestas", "POST", [{ id: a, acierto: true }])).status).toBe(201);
  });

  test("las respuestas de preguntas inexistentes se ignoran", async () => {
    const r = await pet("/api/respuestas", "POST", { respuestas: [{ id: 99999, acierto: true }] });
    expect((await r.json()).registradas).toBe(0);
    expect(repo.db.query("SELECT COUNT(*) n FROM respuestas").get().n).toBe(0);
  });

  test("el cupo de nuevas cuenta primeras respuestas de test y no las de simulacro", async () => {
    const bank = await ids();
    await pet("/api/respuestas", "POST", { respuestas: [
      { id: bank[0], acierto: true }, { id: bank[0], acierto: false }, { id: bank[1], acierto: true },
    ] });
    let c = await carga();
    expect(c).toMatchObject({ nuevasHoy: 2, cupoNuevas: CUPO_NUEVAS, repasosPendientes: 0, bloqueadoPorAtraso: false });

    await pet("/api/simulacros", "POST", {
      temas: [1], segundos: 5, penalizacion: 0, respuestas: [{ id: bank[2], elegida: 0 }],
    });
    c = await carga();
    expect(c.nuevasHoy).toBe(2); // el simulacro no consume cupo

    const d = await (await pet("/api/test?temas=1")).json();
    expect(d.carga).toMatchObject({ nuevasHoy: 2, cupoNuevas: CUPO_NUEVAS });
  });

  test("el freno de atraso bloquea las nuevas cuando hay demasiados repasos vencidos", async () => {
    const tema = repo.temario()[0].temas[0].id;
    const objetivo = FRENO_ATRASO * CUPO_NUEVAS + 1;
    for (let i = TOTAL_TEMA_1; i < objetivo; i++)
      repo.crear(nueva({ tema, pregunta: "Pregunta atraso " + i }));
    const preguntas = repo.paraTest([tema]).preguntas;
    expect(preguntas).toHaveLength(objetivo);
    const ayer = sumarDias(hoyIso(), -1);
    repo.guardarProgreso(preguntas.map((p) => ({ id: p.id, caja: 1, vence: ayer, aciertos: 0, fallos: 1 })));

    const c = await carga();
    expect(c.repasosAtrasados).toBe(objetivo);
    expect(c.bloqueadoPorAtraso).toBe(true);
    // Un repaso vencido hoy no cuenta como atraso.
    repo.guardarProgreso([{ id: preguntas[0].id, caja: 1, vence: hoyIso(), aciertos: 0, fallos: 1 }]);
    expect((await carga()).repasosAtrasados).toBe(objetivo - 1);
  });

  test("la racha cuenta días consecutivos con respuestas (hoy o ayer como extremo)", async () => {
    const [a] = await ids();
    const hoy = hoyIso();
    for (const d of [hoy, sumarDias(hoy, -1), sumarDias(hoy, -2)]) repo.registrarRespuestas([{ id: a, acierto: 1, ms: null }], d);
    repo.registrarRespuestas([{ id: a, acierto: 1, ms: null }], sumarDias(hoy, -4)); // hueco
    expect(repo.rachaDias(hoy)).toBe(3);
    expect(repo.rachaDias(sumarDias(hoy, 1))).toBe(3); // sin actividad hoy, sigue viva ayer
    expect(repo.rachaDias(sumarDias(hoy, 10))).toBe(0);
  });

  test("la precisión semanal agrupa de lunes a domingo", async () => {
    const [a] = await ids();
    repo.registrarRespuestas([{ id: a, acierto: 1, ms: null }], "2026-03-09"); // lunes
    repo.registrarRespuestas([{ id: a, acierto: 0, ms: null }], "2026-03-15"); // domingo
    repo.registrarRespuestas([{ id: a, acierto: 1, ms: null }], "2026-03-16"); // lunes siguiente
    expect(repo.precisionSemanal("2026-03-22", 8)).toEqual([
      { desde: "2026-03-09", hasta: "2026-03-15", aciertos: 1, fallos: 1 },
      { desde: "2026-03-16", hasta: "2026-03-22", aciertos: 1, fallos: 0 },
    ]);
  });

  test("el simulacro registra sus respuestas con origen simulacro (sin blancos)", async () => {
    const bank = await ids();
    await pet("/api/simulacros", "POST", { temas: [1], segundos: 5, penalizacion: 0, respuestas: [
      { id: bank[0], elegida: 0 }, { id: bank[1], elegida: -1 },
    ] });
    expect(repo.db.query("SELECT pregunta_id, origen FROM respuestas ORDER BY id").all()).toEqual([
      { pregunta_id: bank[0], origen: "simulacro" },
    ]);
  });

  test("reiniciar el progreso también limpia las respuestas y la racha", async () => {
    const [a] = await ids();
    await pet("/api/respuestas", "POST", { respuestas: [{ id: a, acierto: true, ms: 1000 }] });
    expect((await carga()).nuevasHoy).toBe(1);
    await pet("/api/progreso", "DELETE");
    expect((await carga()).nuevasHoy).toBe(0);
    expect(repo.rachaDias(hoyIso())).toBe(0);
  });

  test("la página de estadísticas muestra racha, precisión semanal y tiempo medio", async () => {
    const [a, b] = await ids();
    await pet("/api/respuestas", "POST", { respuestas: [
      { id: a, acierto: true, ms: 1000 }, { id: b, acierto: false, ms: 3000 },
    ] });
    const html = await (await pet("/estadisticas")).text();
    expect(html).toContain("racha");
    expect(html).toContain("2.0 s");
    expect(html).toContain("Precisión por semana");
    expect(html).toContain("Evolución de los simulacros");
  });

  test("la fecha de examen se guarda, se valida y acorta el intervalo (Fase 3.6)", async () => {
    expect((await pet("/api/ajustes", "PUT", { fecha_examen: "2026-13-40" })).status).toBe(400);
    expect((await pet("/api/ajustes", "PUT", { fecha_examen: "2026-02-30" })).status).toBe(400);

    const examen = sumarDias(hoyIso(), 100);
    const r = await pet("/api/ajustes", "PUT", { fecha_examen: examen });
    expect(r.status).toBe(200);
    expect((await r.json()).examen).toMatchObject({ fecha: examen, dias: 100, topeDias: 15 });

    const d = await (await pet("/api/test?temas=1")).json();
    expect(d.examen).toMatchObject({ fecha: examen, topeDias: 15 });

    const html = await (await pet("/")).text();
    expect(html).toContain('id="cfg-examen"');
    expect(html).toContain("100 días hasta el examen");

    await pet("/api/ajustes", "PUT", { fecha_examen: null });
    expect((await (await pet("/api/ajustes")).json()).fecha_examen).toBeUndefined();
  });
});

describe("validación de la cabecera Host (Fase 4.1)", () => {
  const conHost = (host, ruta = "/") =>
    app(new Request("http://" + host + ruta, { headers: { Host: host } }));

  test("acepta los hosts locales, con y sin puerto", async () => {
    for (const h of ["localhost", "localhost:8000", "127.0.0.1", "127.0.0.1:8000", "[::1]:8000"])
      expect((await conHost(h)).status).toBe(200);
  });

  test("rechaza un Host ajeno (DNS rebinding) sin filtrar datos", async () => {
    const r = await conHost("evil.com", "/api/temas");
    expect(r.status).toBe(403);
    expect(await r.text()).not.toContain("total");
  });

  test("manda la cabecera Host, no la URL", async () => {
    const r = await app(new Request("http://localhost/", { headers: { Host: "evil.com" } }));
    expect(r.status).toBe(403);
  });
});

describe("búsqueda con FTS5 (Fase 4.6)", () => {
  const hayFts = () => !!repo.db.query("SELECT 1 FROM sqlite_master WHERE name = 'preguntas_fts'").get();

  test("encuentra sin tildes y sin distinguir mayúsculas", () => {
    if (!hayFts()) return; // build sin FTS5: el respaldo en JS no cubre las tildes
    const tema = crearTemaPrueba(1);
    repo.crear(nueva({ tema, pregunta: "Normalización de bases de datos" }));
    repo.crear(nueva({ tema, pregunta: "Transacciones ACID y atomicidad" }));
    expect(repo.listar({ texto: "normalizacion" }).total).toBe(1);
    expect(repo.listar({ texto: "NORMALIZACIÓN" }).total).toBe(1);
    expect(repo.listar({ texto: "norm" }).total).toBe(1);
    expect(repo.listar({ texto: "bases datos" }).total).toBe(1);
    expect(repo.listar({ texto: "acid" }).total).toBe(1);
    expect(repo.listar({ texto: "inexistente" }).total).toBe(0);
  });

  test("respeta el filtro por tema", () => {
    if (!hayFts()) return;
    const t1 = crearTemaPrueba(1), t2 = crearTemaPrueba(2);
    repo.crear(nueva({ tema: t1, pregunta: "Normalización en el tema uno" }));
    repo.crear(nueva({ tema: t2, pregunta: "Normalización en el tema dos" }));
    expect(repo.listar({ texto: "normalizacion" }).total).toBe(2);
    expect(repo.listar({ tema: t1, texto: "normalizacion" }).total).toBe(1);
  });

  test("se mantiene al crear, modificar y borrar", () => {
    if (!hayFts()) return;
    const tema = crearTemaPrueba(1);
    const id = repo.crear(nueva({ tema, pregunta: "Alicates de precisión" }));
    expect(repo.listar({ texto: "alicates" }).total).toBe(1);
    repo.actualizar(id, nueva({ tema, pregunta: "Destornilladores planos" }));
    expect(repo.listar({ texto: "alicates" }).total).toBe(0);
    expect(repo.listar({ texto: "destornilladores" }).total).toBe(1);
    repo.borrar(id);
    expect(repo.listar({ texto: "destornilladores" }).total).toBe(0);
  });

  test("una consulta con caracteres especiales no rompe la búsqueda", () => {
    if (!hayFts()) return;
    const tema = crearTemaPrueba(1);
    repo.crear(nueva({ tema, pregunta: "Entidad-relación" }));
    expect(() => repo.listar({ texto: 'foo"bar (baz) NEAR*' })).not.toThrow();
    expect(repo.listar({ texto: 'foo"bar (baz)' }).total).toBe(0);
  });
});

describe("compresión gzip de las respuestas (Fase 4.4)", () => {
  beforeEach(async () => { await importarDirectorio(repo, DIR_FIXTURE); });

  test("comprime HTML y JSON grandes si el cliente acepta gzip", async () => {
    const desc = (buf) => new TextDecoder().decode(buf);
    const html = await app(new Request("http://localhost/estadisticas", { headers: { "Accept-Encoding": "gzip" } }));
    expect(html.headers.get("content-encoding")).toBe("gzip");
    expect(html.headers.get("vary")).toContain("Accept-Encoding");
    expect(desc(Bun.gunzipSync(Buffer.from(await html.arrayBuffer())))).toContain("racha");

    const exp = await app(new Request("http://localhost/api/exportar", { headers: { "Accept-Encoding": "gzip" } }));
    const texto = desc(Bun.gunzipSync(Buffer.from(await exp.arrayBuffer())));
    expect(JSON.parse(texto).length).toBe(TOTAL_FIXTURE);
  });

  test("sin Accept-Encoding no comprime y respuestas pequeñas van en claro", async () => {
    expect((await pet("/estadisticas")).headers.get("content-encoding")).toBe(null);
    const pequena = await app(new Request("http://localhost/api/temas", { headers: { "Accept-Encoding": "gzip" } }));
    expect(pequena.headers.get("content-encoding")).toBe(null);
    expect(pequena.headers.get("vary")).toContain("Accept-Encoding");
  });
});

describe("fuentes autoalojadas (Fase 4.2)", () => {
  test("el HTML no depende de Google Fonts y sirve los woff2 locales", async () => {
    const html = await (await pet("/")).text();
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain("/css/base.css");

    const f = await pet("/fonts/newsreader-latin.woff2");
    expect(f.status).toBe(200);
    expect(f.headers.get("content-type")).toContain("font/woff2");
    expect(f.headers.get("cache-control")).toContain("immutable");
  });
});

describe("autenticación opcional y healthz", () => {
  const basic = (u, c) => ({ Authorization: "Basic " + btoa(u + ":" + c) });
  test("con auth: 401 sin credenciales, 200 con ellas, /healthz libre", async () => {
    const protegida = crearApp(repo, { auth: { usuario: "ana", clave: "se:creto" } });
    const get = (ruta, headers = {}) => protegida(new Request("http://localhost" + ruta, { headers }));
    expect((await get("/")).status).toBe(401);
    expect((await get("/api/temas")).status).toBe(401);
    expect((await get("/", basic("ana", "mal"))).status).toBe(401);
    expect((await get("/", basic("ana", "se:creto"))).status).toBe(200);
    expect((await get("/healthz")).status).toBe(200);
  });
  test("sin auth todo es accesible", async () => {
    expect((await pet("/healthz")).status).toBe(200);
    expect((await pet("/")).status).toBe(200);
  });
});
