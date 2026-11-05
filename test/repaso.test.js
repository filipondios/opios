import { describe, expect, test } from "bun:test";
import {
  Sesion,
  INTERVALOS_DIAS,
  PASOS_APRENDIZAJE,
  PROB_REPASO,
  hoyIso,
  sumarDias,
} from "../public/js/repaso.js";

const HOY = "2026-03-10";
const q = (i) => ({ i });

/** Crea una sesión determinista: fecha fija y azar controlado. */
function crear(pool, opciones = {}) {
  const progreso = opciones.progreso ?? {};
  const cambios = [];
  const sesion = new Sesion(pool, {
    progreso,
    hoy: () => HOY,
    azar: () => 0,
    alCambiar: (id) => cambios.push(id),
    ...opciones,
  });
  return { sesion, progreso, cambios };
}

describe("fechas del repaso", () => {
  test("sumarDias cruza meses, años y bisiestos", () => {
    expect(sumarDias("2026-03-10", 1)).toBe("2026-03-11");
    expect(sumarDias("2026-03-31", 1)).toBe("2026-04-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2024-02-28", 1)).toBe("2024-02-29");
    expect(sumarDias("2026-01-01", -1)).toBe("2025-12-31");
  });

  test("hoyIso usa la fecha local", () => {
    expect(hoyIso(new Date(2026, 2, 10, 23, 59))).toBe(HOY);
  });
});

describe("planificador de repaso", () => {
  test("un fallo deja caja 0, vence hoy y programa el reintento", () => {
    const pool = [q(1), q(2)];
    const { sesion, progreso, cambios } = crear(pool);

    sesion.registrar(pool[0], false);

    expect(progreso[1]).toEqual([0, HOY, 0, 1]);
    expect(sesion.fallos).toBe(1);
    expect(sesion.aciertos).toBe(0);
    expect(sesion.n).toBe(1);
    expect(sesion.aprendizaje.get(1)).toEqual([0, 1 + PASOS_APRENDIZAJE[0]]);
    expect(cambios).toEqual([1]);
  });

  test("el reintento llega tras 3 preguntas y tiene prioridad sobre las nuevas", () => {
    const pool = [q(1), q(2), q(3), q(4), q(5)];
    const { sesion } = crear(pool);

    sesion.registrar(pool[0], false); // n=1; reintento en 4
    sesion.registrar(pool[1], true);  // n=2
    sesion.registrar(pool[2], true);  // n=3

    let [pregunta, tipo] = sesion.siguiente();
    expect(tipo).toBe("Nueva");
    expect([4, 5]).toContain(pregunta.i);

    sesion.registrar(pregunta, true); // n=4: ya toca el reintento
    [pregunta, tipo] = sesion.siguiente();
    expect(tipo).toBe("Reintento");
    expect(pregunta.i).toBe(1);
  });

  test("acertar el reintento mantiene caja 0 y el segundo acierto gradúa a caja 1", () => {
    const pool = [q(1)];
    const { sesion, progreso } = crear(pool);

    sesion.registrar(pool[0], false);
    sesion.registrar(pool[0], true); // primer acierto del reintento

    expect(sesion.aprendizaje.get(1)).toEqual([1, 2 + PASOS_APRENDIZAJE[1]]);
    expect(progreso[1][0]).toBe(0);
    expect(progreso[1][1]).toBe(HOY);
    expect(progreso[1][2]).toBe(1);

    sesion.registrar(pool[0], true); // segundo acierto: gradúa

    expect(sesion.aprendizaje.has(1)).toBe(false);
    expect(progreso[1][0]).toBe(1);
    expect(progreso[1][1]).toBe(sumarDias(HOY, INTERVALOS_DIAS[1]));
    expect(progreso[1][2]).toBe(2);
  });

  test("una pregunta fallada en una sesión anterior recibe un reintento antes de graduarse", () => {
    const pool = [q(1)];
    const { sesion, progreso } = crear(pool, { progreso: { 1: [0, "2026-03-01", 2, 3] } });

    sesion.registrar(pool[0], true);

    expect(sesion.aprendizaje.get(1)).toEqual([1, 1 + PASOS_APRENDIZAJE[1]]);
    expect(progreso[1]).toEqual([0, "2026-03-01", 3, 3]);
  });

  test("un acierto normal sube de caja y alarga el intervalo", () => {
    const pool = [q(1)];
    const { sesion, progreso } = crear(pool, { progreso: { 1: [2, "2026-03-01", 5, 1] } });

    sesion.registrar(pool[0], true);

    expect(progreso[1]).toEqual([3, sumarDias(HOY, INTERVALOS_DIAS[3]), 6, 1]);
  });

  test("la caja no supera el máximo", () => {
    const pool = [q(1)];
    const caja = INTERVALOS_DIAS.length - 1;
    const { sesion, progreso } = crear(pool, { progreso: { 1: [caja, "2026-03-01", 1, 0] } });

    sesion.registrar(pool[0], true);

    expect(progreso[1][0]).toBe(caja);
    expect(progreso[1][1]).toBe(sumarDias(HOY, INTERVALOS_DIAS[caja]));
  });

  test("con repasos y nuevas, el azar decide y el repaso más antiguo va primero", () => {
    const pool = [q(1), q(2), q(3)];
    const progreso = { 1: [1, "2026-03-09", 2, 0], 2: [1, "2026-03-08", 2, 0] };

    const conRepaso = crear(pool, { progreso, azar: () => 0.1 });
    let [pregunta, tipo] = conRepaso.sesion.siguiente();
    expect(tipo).toBe("Repaso");
    expect(pregunta.i).toBe(2); // vence antes

    const conNueva = crear(pool, { progreso: { ...progreso }, azar: () => PROB_REPASO });
    [pregunta, tipo] = conNueva.sesion.siguiente();
    expect(tipo).toBe("Nueva");
    expect(pregunta.i).toBe(3);
  });

  test("sin nada pendiente entra en práctica libre y evita la última pregunta", () => {
    const pool = [q(1), q(2)];
    const { sesion } = crear(pool, {
      progreso: { 1: [3, "2026-04-01", 1, 0], 2: [3, "2026-04-01", 1, 0] },
      azar: () => 0,
    });
    sesion.ultima = 1;

    const [pregunta, tipo] = sesion.siguiente();

    expect(tipo).toBe("Práctica libre");
    expect(pregunta.i).toBe(2);
  });

  test("pendientes cuenta repasos vencidos y nuevas", () => {
    const pool = [q(1), q(2), q(3)];
    const { sesion } = crear(pool, {
      progreso: { 1: [1, HOY, 1, 0], 2: [1, "2026-03-11", 1, 0] },
    });

    expect(sesion.pendientes()).toEqual({ rep: 1, nue: 1 });
  });

  test("avisa del cambio para guardar el progreso", () => {
    const pool = [q(1)];
    const { sesion, cambios } = crear(pool);

    sesion.registrar(pool[0], false);
    sesion.registrar(pool[0], true);

    expect(cambios).toEqual([1, 1]);
  });
});
