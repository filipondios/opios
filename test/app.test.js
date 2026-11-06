import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { abrirDb } from "../src/db.js";
import { crearApp } from "../src/app.js";
import { exportarPorBloques } from "../src/exportar.js";
import { importarDirectorio } from "../src/seed.js";
import { DIR_PREGUNTAS } from "../src/config.js";
import { hoyIso } from "../src/fechas.js";

const DIR_FIXTURE = join(import.meta.dir, "fixtures");
const DIR_BLOQUES = join(import.meta.dir, "fixtures-bloques");
const TOTAL_TEMA_1 = 4;
const TOTAL_TEMA_2 = 3;
const TOTAL_FIXTURE = TOTAL_TEMA_1 + TOTAL_TEMA_2;

let repo, app;
const JSON_H = { "Content-Type": "application/json" };
const pet = (ruta, metodo = "GET", cuerpo) =>
  app(new Request("http://localhost" + ruta, { method: metodo, headers: cuerpo !== undefined ? JSON_H : {}, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined }));
const nueva = (o = {}) => ({ tema: 3, pregunta: "¿Capital de Francia?", respuestas: ["París", "Roma", "Lisboa"], correcta: 0, explicacion: "", ...o });

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
  test("crear, leer, editar y borrar", async () => {
    const c = await pet("/api/preguntas", "POST", nueva());
    expect(c.status).toBe(201);
    const p = await c.json();
    expect(p).toMatchObject({ tema: 3, correcta: 0, respuestas: ["París", "Roma", "Lisboa"] });
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
    for (let i = 0; i < 5; i++) await pet("/api/preguntas", "POST", nueva({ tema: i % 2, pregunta: "Pregunta número " + i }));
    expect((await (await pet("/api/preguntas?tema=0")).json()).total).toBe(3);
    expect((await (await pet("/api/preguntas?q=NÚMERO 4")).json()).items.length).toBe(1);
    const pag = await (await pet("/api/preguntas?limite=2&desde=2")).json();
    expect(pag.items.length).toBe(2); expect(pag.total).toBe(5);
    expect((await pet("/api/preguntas?limite=0")).status).toBe(400);
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
    expect(m).toContain('href="/"'); expect(m).toContain("Hacer test"); expect(m).toContain("/js/maker.js");
    const t = await (await pet("/temario")).text();
    expect(t).toContain("/js/temario.js"); expect(t).toContain("Nuevo bloque");
    expect((await pet("/fragmentos/temas")).status).toBe(200);
  });
  test("las plantillas escapan HTML", async () => {
    repo.db.query("INSERT INTO temas (id, nombre) VALUES (7, ?)").run('<script>alert(1)</script>');
    await pet("/api/preguntas", "POST", nueva({ tema: 7 }));
    const html = await (await pet("/")).text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });
  test("estáticos y path traversal", async () => {
    for (const f of ["/css/base.css", "/css/test.css", "/css/maker.css", "/css/temario.css", "/css/estadisticas.css", "/css/simulacro.css", "/js/test.js", "/js/repaso.js", "/js/maker.js", "/js/temario.js", "/js/simulacro.js"]) expect((await pet(f)).status).toBe(200);
    expect((await pet("/../server.js")).status).toBe(404);
    expect((await pet("/%2e%2e/server.js")).status).toBe(404);
    expect((await pet("/nada.js")).status).toBe(404);
  });
});

describe("fecha inyectada", () => {
  test("crearApp usa `ahora` para calcular los repasos de hoy", async () => {
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
    const js = await (await pet("/js/simulacro.js")).text();
    expect(js).toContain("q.originales[respuestas[i]]");
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
      expect.objectContaining({ id: bank[0].id, fallos: 1, aciertos: 0, caja: null }),
    ]);
  });

  test("los fallos de test y simulacro se suman en la misma pregunta", async () => {
    const bank = await conProgreso();
    await pet("/api/simulacros", "POST", {
      temas: [1], segundos: 20, penalizacion: 0,
      respuestas: [{ id: bank[1].id, elegida: (bank[1].correcta + 1) % bank[1].respuestas.length }],
    });
    const fila = repo.preguntasMasFalladas(20).find((p) => p.id === bank[1].id);
    expect(fila).toMatchObject({ fallos: 4, aciertos: 0, caja: 0 }); // 3 del test + 1 del simulacro
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
  const evaluarCliente = async (archivo) => {
    const codigo = await Bun.file(join(import.meta.dir, "..", "public", "js", archivo)).text();
    const global = {};
    new Function("window", codigo)(global);
    return global;
  };

  test("la etiqueta de tema es la misma en servidor y cliente", async () => {
    const { etiquetaTema } = await import("../src/etiquetas.js");
    const { etiquetaTema: enCliente } = await evaluarCliente("etiquetas.js");
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
    const { calcularResultado } = await evaluarCliente("resultado.js");
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
