import { ErrorApi } from "../errores.js";
import { marcas } from "./esquema.js";

/**
 * Métodos de bloques y temas.
 * Devuelve también las ayudas internas que necesita el importador de preguntas.
 */
export function crearTemario({ db, q }) {
    /* Primer bloque por orden, o uno nuevo si aún no hay ninguno. */
    function bloquePorDefecto() {
        const b = db.query("SELECT id FROM bloques ORDER BY orden, id LIMIT 1").get();
        if (b) return b.id;
        return Number(
            db.query("INSERT INTO bloques (numero, nombre, orden) VALUES (1, 'Bloque 1', 0)").run().lastInsertRowid,
        );
    }

    /* Bloque por su nombre; si no existe, se crea al final con el siguiente número. */
    function bloquePorNombre(nombre) {
        const b = db.query("SELECT id FROM bloques WHERE nombre = ?").get(nombre);
        if (b) return b.id;
        const numero = db.query("SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM bloques").get().n;
        const orden = db.query("SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM bloques").get().n;
        return Number(
            db.query("INSERT INTO bloques (numero, nombre, orden) VALUES (?, ?, ?)").run(numero, nombre, orden)
                .lastInsertRowid,
        );
    }

    /* Bloque por número (identidad estable); si no existe, se crea con ese nombre. */
    function asegurarBloque(numero, nombre) {
        const b = db.query("SELECT id FROM bloques WHERE numero = ?").get(numero);
        if (b) return b.id;
        const orden = db.query("SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM bloques").get().n;
        return Number(
            db
                .query("INSERT INTO bloques (numero, nombre, orden) VALUES (?, ?, ?)")
                .run(numero, nombre || `Bloque ${numero}`, orden).lastInsertRowid,
        );
    }

    /* Resuelve un tema del formato antiguo (sin bloque): su `tema` es el número dentro del bloque por defecto. */
    function temaLegacy(numero) {
        const bloque = bloquePorDefecto();
        const existente = q.temaPorBloqueNumero.get(bloque, numero);
        if (existente) return existente.id;
        return Number(q.insertarTema.run(bloque, numero, null).lastInsertRowid);
    }

    /* Garantiza que existe el tema `numero` dentro del bloque (por número estable o, si falta, por nombre). */
    function asegurarTemaEnBloque(bloqueNumero, bloqueNombre, numero) {
        const bloque =
            bloqueNumero != null ? asegurarBloque(bloqueNumero, bloqueNombre) : bloquePorNombre(bloqueNombre);
        const existente = q.temaPorBloqueNumero.get(bloque, numero);
        if (existente) return existente.id;
        return Number(q.insertarTema.run(bloque, numero, null).lastInsertRowid);
    }

    /* Un tema con su número de preguntas, tal y como lo usa la página de temario. */
    function temaConPreguntas(id) {
        return (
            db
                .query(`
      SELECT t.id, t.bloque_id AS bloque, t.numero, t.nombre, COUNT(p.id) AS preguntas
      FROM temas t LEFT JOIN preguntas p ON p.tema_id = t.id
      WHERE t.id = ? GROUP BY t.id`)
                .get(id) ?? null
        );
    }

    const repo = {
        /** Bloques ordenados con sus temas (numerados dentro del bloque) y el número de preguntas de cada tema. */
        temario() {
            const bloques = db
                .query("SELECT id, numero, nombre, orden, gestionado FROM bloques ORDER BY orden, id")
                .all()
                .map((b) => ({
                    id: b.id,
                    numero: b.numero,
                    nombre: b.nombre,
                    orden: b.orden,
                    gestionado: !!b.gestionado,
                    temas: [],
                }));
            const porId = new Map(bloques.map((b) => [b.id, b]));
            const filas = db
                .query(`
        SELECT t.id, t.bloque_id AS bloque, t.numero, t.nombre, COUNT(p.id) AS preguntas
        FROM temas t LEFT JOIN preguntas p ON p.tema_id = t.id
        GROUP BY t.id ORDER BY COALESCE(t.numero, t.id), t.id`)
                .all();
            const sinBloque = { id: null, nombre: "Sin bloque", orden: Number.MAX_SAFE_INTEGER, temas: [] };
            for (const f of filas) {
                const tema = { id: f.id, numero: f.numero, nombre: f.nombre, preguntas: f.preguntas };
                const b = porId.get(f.bloque);
                if (b) b.temas.push(tema);
                else sinBloque.temas.push(tema);
            }
            if (sinBloque.temas.length) bloques.push(sinBloque);
            return bloques;
        },

        /** Crea el bloque si no existe; no cambia el nombre de uno existente. */
        asegurarBloque: db.transaction(({ numero, nombre }) => {
            const id = asegurarBloque(numero, nombre);
            return db.query("SELECT id, numero, nombre, orden, gestionado FROM bloques WHERE id = ?").get(id);
        }),

        /**
         * Sincroniza un bloque con su `info.json`: nombre, títulos de temas y marca de gestionado.
         * No borra temas que ya no aparezcan en el archivo.
         */
        sincronizarInfoBloque: db.transaction((numero, info) => {
            const id = asegurarBloque(numero, info.nombre);
            db.query("UPDATE bloques SET nombre = ?, gestionado = 1 WHERE id = ?").run(info.nombre, id);
            for (const t of info.temas) {
                const existente = q.temaPorBloqueNumero.get(id, t.numero);
                if (existente) db.query("UPDATE temas SET nombre = ? WHERE id = ?").run(t.titulo, existente.id);
                else q.insertarTema.run(id, t.numero, t.titulo);
            }
            return { id, numero, nombre: info.nombre, temas: info.temas.length };
        }),

        /** Quita la marca de gestionado a los bloques que ya no tienen `info.json`. */
        desmarcarGestionadosExcepto: db.transaction((numeros) => {
            const lista = [...new Set(numeros)];
            if (!lista.length) return db.query("UPDATE bloques SET gestionado = 0 WHERE gestionado = 1").run().changes;
            return db
                .query(
                    `UPDATE bloques SET gestionado = 0 WHERE gestionado = 1 AND numero NOT IN (${marcas(lista.length)})`,
                )
                .run(...lista).changes;
        }),

        crearBloque: db.transaction(({ nombre }) => {
            if (db.query("SELECT 1 FROM bloques WHERE nombre = ?").get(nombre))
                throw new ErrorApi(409, `Ya existe el bloque «${nombre}».`);
            const numero = db.query("SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM bloques").get().n;
            const orden = db.query("SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM bloques").get().n;
            const id = Number(
                db.query("INSERT INTO bloques (numero, nombre, orden) VALUES (?, ?, ?)").run(numero, nombre, orden)
                    .lastInsertRowid,
            );
            return { id, numero, nombre, orden, gestionado: false, temas: [] };
        }),

        actualizarBloque: db.transaction((id, { nombre }) => {
            const bloque = db.query("SELECT id, numero, gestionado FROM bloques WHERE id = ?").get(id);
            if (!bloque) return false;
            if (bloque.gestionado)
                throw new ErrorApi(409, "Este bloque se define en preguntas/bloque_X/info.json y es de solo lectura.");
            const otro = db.query("SELECT id FROM bloques WHERE nombre = ? AND id <> ?").get(nombre, id);
            if (otro) throw new ErrorApi(409, `Ya existe el bloque «${nombre}».`);
            db.query("UPDATE bloques SET nombre = ? WHERE id = ?").run(nombre, id);
            return { id, numero: bloque.numero, nombre, gestionado: false };
        }),

        borrarBloque(id) {
            const bloque = db.query("SELECT gestionado FROM bloques WHERE id = ?").get(id);
            if (bloque?.gestionado)
                throw new ErrorApi(409, "Este bloque se define en preguntas/bloque_X/info.json y es de solo lectura.");
            const n = db
                .query(`SELECT COUNT(*) AS n FROM temas t JOIN bloques b ON b.id = t.bloque_id WHERE b.id = ?`)
                .get(id).n;
            if (n)
                throw new ErrorApi(
                    409,
                    `No se puede borrar el bloque: todavía tiene ${n} tema(s). Muévelos o bórralos primero.`,
                );
            return db.query("DELETE FROM bloques WHERE id = ?").run(id).changes > 0;
        },

        /** Reordena los bloques según la lista de ids (debe incluirlos todos). */
        reordenarBloques: db.transaction((ids) => {
            const actuales = db
                .query("SELECT id FROM bloques")
                .all()
                .map((b) => b.id);
            if (
                ids.length !== actuales.length ||
                new Set(ids).size !== ids.length ||
                !ids.every((id) => actuales.includes(id))
            )
                throw new ErrorApi(400, "La lista de bloques no coincide con los bloques existentes.");
            const upd = db.query("UPDATE bloques SET orden = ? WHERE id = ?");
            ids.forEach((id, i) => upd.run(i, id));
            return true;
        }),

        crearTema: db.transaction(({ bloque, numero, nombre }) => {
            const b = db.query("SELECT gestionado FROM bloques WHERE id = ?").get(bloque);
            if (!b) throw new ErrorApi(404, "El bloque no existe.");
            if (b.gestionado)
                throw new ErrorApi(409, "Este bloque se define en preguntas/bloque_X/info.json y es de solo lectura.");
            if (q.temaPorBloqueNumero.get(bloque, numero))
                throw new ErrorApi(409, `Ya hay un tema ${numero} en ese bloque.`);
            const id = Number(q.insertarTema.run(bloque, numero, nombre || null).lastInsertRowid);
            return temaConPreguntas(id);
        }),

        actualizarTema: db.transaction((id, { bloque, numero, nombre }) => {
            const actual = db
                .query(`
        SELECT t.id, b.gestionado FROM temas t JOIN bloques b ON b.id = t.bloque_id WHERE t.id = ?`)
                .get(id);
            if (!actual) return false;
            if (actual.gestionado)
                throw new ErrorApi(409, "Este tema se define en preguntas/bloque_X/info.json y es de solo lectura.");
            const b = db.query("SELECT gestionado FROM bloques WHERE id = ?").get(bloque);
            if (!b) throw new ErrorApi(404, "El bloque no existe.");
            if (b.gestionado)
                throw new ErrorApi(409, "No se puede mover un tema a un bloque gestionado por info.json.");
            const otro = db
                .query("SELECT id FROM temas WHERE bloque_id = ? AND numero = ? AND id <> ?")
                .get(bloque, numero, id);
            if (otro) throw new ErrorApi(409, `Ya hay un tema ${numero} en ese bloque (nº ${otro.id}).`);
            db.query("UPDATE temas SET bloque_id = ?, numero = ?, nombre = ? WHERE id = ?").run(
                bloque,
                numero,
                nombre || null,
                id,
            );
            return temaConPreguntas(id);
        }),

        borrarTema(id) {
            const t = db
                .query(`SELECT b.gestionado FROM temas t JOIN bloques b ON b.id = t.bloque_id WHERE t.id = ?`)
                .get(id);
            if (t?.gestionado)
                throw new ErrorApi(409, "Este tema se define en preguntas/bloque_X/info.json y es de solo lectura.");
            const n = db.query("SELECT COUNT(*) AS n FROM preguntas WHERE tema_id = ?").get(id).n;
            if (n) throw new ErrorApi(409, `No se puede borrar el tema: todavía tiene ${n} pregunta(s).`);
            return db.query("DELETE FROM temas WHERE id = ?").run(id).changes > 0;
        },
    };

    return { repo, ayudas: { temaLegacy, asegurarTemaEnBloque } };
}
