import { beforeEach, describe, expect, test } from "bun:test";
import { abrirDb } from "../src/db.js";
import { crearApp } from "../src/app.js";
import { importarDirectorio } from "../src/seed.js";
import { DIR_PREGUNTAS } from "../src/config.js";
import { hoyIso } from "../src/fechas.js";

let repo, app;
const JSON_H = { "Content-Type": "application/json" };
const pet = (ruta, metodo = "GET", cuerpo) =>
  app(new Request("http://localhost" + ruta, { method: metodo, headers: cuerpo !== undefined ? JSON_H : {}, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined }));
const nueva = (o = {}) => ({ tema: 3, pregunta: "¿Capital de Francia?", respuestas: ["París", "Roma", "Lisboa"], correcta: 0, explicacion: "", ...o });

beforeEach(() => { repo = abrirDb(":memory:"); app = crearApp(repo); });

describe("importación de los JSON existentes", () => {
  test("importa todo, es idempotente y conserva la respuesta correcta", async () => {
    const r1 = await importarDirectorio(repo, DIR_PREGUNTAS);
    expect(r1.errores).toEqual([]);
    expect(r1.nuevas).toBe(198);
    const r2 = await importarDirectorio(repo, DIR_PREGUNTAS);
    expect(r2.nuevas).toBe(0);
    expect(r2.duplicadas).toBe(198);
    const orig = (await Bun.file(DIR_PREGUNTAS + "/tema_1.json").json())[0];
    const p = repo.listar({ tema: 1, texto: orig.pregunta }).items[0];
    expect(p.respuestas).toEqual(orig.respuestas);
    expect(p.correcta).toBe("abcdefgh".indexOf(orig.respuesta_correcta));
  });
  test("exportar y reimportar da el mismo banco", async () => {
    await importarDirectorio(repo, DIR_PREGUNTAS);
    const txt = await (await pet("/api/exportar")).text();
    const otra = abrirDb(":memory:");
    const dir = (await import("node:os")).tmpdir() + "/opios-test-" + Date.now();
    await Bun.write(dir + "/x.json", txt);
    const r = await importarDirectorio(otra, dir);
    expect(r.errores).toEqual([]);
    expect(otra.todas()).toEqual(repo.todas().map((p) => ({ ...p, id: expect.any(Number) })));
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
  beforeEach(async () => { await importarDirectorio(repo, DIR_PREGUNTAS); });

  test("/api/test devuelve preguntas del tema y su progreso", async () => {
    const d = await (await pet("/api/test?temas=2")).json();
    expect(d.preguntas.length).toBe(100);
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
    expect(t1).toMatchObject({ total: 98, nuevas: 96, dominadas: 1, aprendiendo: 1, repaso: 0 });
    expect(await (await pet("/")).text()).toContain("96");
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
    await importarDirectorio(repo, DIR_PREGUNTAS);
    html = await (await pet("/")).text();
    expect(html).toContain('data-tema="1"'); expect(html).toContain('data-tema="2"');
    expect(html).toContain('href="/maker"'); expect(html).toContain("/js/test.js");
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
    for (const f of ["/css/base.css", "/css/test.css", "/css/maker.css", "/css/temario.css", "/js/test.js", "/js/maker.js", "/js/temario.js"]) expect((await pet(f)).status).toBe(200);
    expect((await pet("/../server.js")).status).toBe(404);
    expect((await pet("/%2e%2e/server.js")).status).toBe(404);
    expect((await pet("/nada.js")).status).toBe(404);
  });
});

describe("temario por bloques", () => {
  beforeEach(async () => { await importarDirectorio(repo, DIR_PREGUNTAS); });

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
