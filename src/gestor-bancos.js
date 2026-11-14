/* DatabaseManager (task 5 del TODO): catálogo de bancos de preguntas + banco activo.
   El catálogo es una SQLite pequeña (`data/catalogo.db` por decidir en la task 6) con la
   lista de bancos y su ruta; el progreso vive dentro de cada banco (cada SQLite). Solo
   hay una conexión de banco abierta a la vez: se cierra antes de abrir otra (riesgo
   del TODO: evitar cambiar de banco durante una sesión). El modo directo `OPIOS_DB`
   sigue siendo legacy y no pasa por aquí. */
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { abrirDb } from "./db/bun.js";
import { validarBancoSqlite } from "./db/validar-sqlite.js";
import { importarDirectorio } from "./seed.js";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS bancos (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(nombre)) > 0),
  ruta   TEXT NOT NULL UNIQUE,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS estado (
  clave TEXT PRIMARY KEY,
  valor TEXT
);
`;

export class DatabaseManager {
    #catalogo;
    #rutaCatalogo;
    #abierto = null; // { id, repo } del banco con la conexión abierta, o null

    constructor(rutaCatalogo) {
        if (rutaCatalogo !== ":memory:") mkdirSync(dirname(rutaCatalogo), { recursive: true });
        this.#rutaCatalogo = rutaCatalogo;
        this.#catalogo = new Database(rutaCatalogo, { create: true, strict: true });
        this.#catalogo.run("PRAGMA foreign_keys = ON");
        this.#catalogo.run(ESQUEMA);
    }

    /** Registra un banco SQLite existente. Ruta y nombre deben ser únicos y el banco válido. */
    registrar(nombre, ruta) {
        if (!ruta.trim()) throw new Error("Indica la ruta del banco.");
        if (!existsSync(ruta))
            throw new Error(`El banco «${ruta}» no existe. Registra una SQLite existente o copia primero el archivo.`);
        /* Validar ANTES de anotarlo en el catálogo: un banco inválido no entra nunca. */
        validarBancoSqlite(ruta);
        const fila = this.#catalogo
            .query("INSERT INTO bancos (nombre, ruta) VALUES (?, ?)")
            .run(nombre.trim(), ruta); // el UNIQUE de la tabla lanza con un error claro
        return { id: fila.lastInsertRowid, nombre: nombre.trim(), ruta };
    }

    /** Crea un banco nuevo importando un directorio JSON (misma estructura que el seed).
        Escribe en un temporal y renombra: el banco aparece completo o no aparece. */
    async importarJson(nombre, dirPreguntas) {
        const ruta = this.rutaDestino(nombre);
        const temporal = ruta + ".tmp";
        this.#quitarSiExiste(temporal);
        const repo = abrirDb(temporal);
        try {
            const r = await importarDirectorio(repo, dirPreguntas);
            if (r.errores.length) {
                repo.close();
                this.#quitarSiExiste(temporal);
                throw new Error(`Importación con errores (${r.errores.length}); banco no creado. Primera: ${r.errores[0]}`);
            }
        } finally {
            repo.close();
        }
        return this.#anotar(nombre, temporal, ruta);
    }

    /** Copia un banco SQLite existente al catálogo (el original queda intacto y registrado
        donde estaba). Copia a temporal + valida + renombra: nunca queda un banco a medias. */    copiar(nombre, rutaOrigen) {
        if (!existsSync(rutaOrigen)) throw new Error(`No existe el banco «${rutaOrigen}».`);
        const ruta = this.rutaDestino(nombre);
        const temporal = ruta + ".tmp";
        this.#quitarSiExiste(temporal);
        copyFileSync(rutaOrigen, temporal);
        return this.#anotar(nombre, temporal, ruta);
    }

    /* Valida el temporal, lo renombra a su lugar definitivo y lo anota en el catálogo. */
    #anotar(nombre, temporal, ruta) {
        try {
            validarBancoSqlite(temporal);
            renameSync(temporal, ruta); // atómico dentro del mismo directorio
            /* El rename solo mueve el .db: si Bun dejó sidecars WAL del temporal, quedan huérfanos. */
            for (const lado of ["-wal", "-shm"]) rmSync(temporal + lado, { force: true });
        } catch (e) {
            this.#quitarSiExiste(temporal);
            throw e;
        }
        const fila = this.#catalogo.query("INSERT INTO bancos (nombre, ruta) VALUES (?, ?)").run(nombre.trim(), ruta);
        return { id: fila.lastInsertRowid, nombre: nombre.trim(), ruta };
    }

    #quitarSiExiste(ruta) {
        if (!existsSync(ruta)) return;
        rmSync(ruta);
        /* Los sidecars WAL/SHM de un temporal huérfano podrían "recuperarse" si un
           temporal futuro reutiliza el nombre: hay que borrarlos con él. */
        for (const lado of ["-wal", "-shm"]) rmSync(ruta + lado, { force: true });
    }

    /** Ruta definitiva de un banco nuevo (junto al catálogo). Falla si ya existe. */
    rutaDestino(nombre) {
        const limpio = String(nombre).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
        if (!limpio) throw new Error("Nombre de banco no válido.");
        const ruta = join(dirname(this.#rutaCatalogo), `${limpio}.db`);
        if (existsSync(ruta)) throw new Error(`Ya existe ${ruta}; elige otro nombre.`);
        return ruta;
    }

    /** Actualiza el banco activo desde un directorio JSON (task 9): en sitio, conservando
        ids internos y progreso mediante `id_externo` (y la deduplicación por enunciado).
        Nunca reemplaza el archivo: primero valida el directorio con una importación de
        ensayo en memoria y, si hay errores, aborta sin tocar el banco. */
    async actualizarActivo(dirPreguntas) {
        const repo = this.abrirActivo();
        /* Ensayo: los errores de validación se detectan sin riesgo para el banco real. */
        const ensayo = abrirDb(":memory:");
        let r;
        try {
            r = await importarDirectorio(ensayo, dirPreguntas, { actualizar: true });
        } finally {
            ensayo.close();
        }
        if (r.errores.length)
            throw new Error(
                `El directorio tiene ${r.errores.length} error(es); banco sin tocar. Primero: ${r.errores[0]}`,
            );
        const final = await importarDirectorio(repo, dirPreguntas, { actualizar: true });
        return { ...final, banco: this.rutaActiva() };
    }

    listar() {
        const activo = this.idActivo();
        return this.#catalogo
            .query("SELECT id, nombre, ruta FROM bancos ORDER BY nombre COLLATE NOCASE, id")
            .all()
            .map((b) => ({ ...b, activo: b.id === activo }));
    }

    idActivo() {
        return Number(this.#catalogo.query("SELECT valor FROM estado WHERE clave = 'activo'").get()?.valor) || null;
    }

    /** Elige el banco activo; cierra el que estuviera abierto (nunca dos conexiones a la vez). */
    activar(id) {
        if (!this.#catalogo.query("SELECT 1 FROM bancos WHERE id = ?").get(id))
            throw new Error(`El banco ${id} no está en el catálogo.`);
        this.cerrar();
        this.#catalogo
            .query("INSERT INTO estado (clave, valor) VALUES ('activo', ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor")
            .run(String(id));
    }

    /** Ruta del banco activo (sin abrirlo). */
    rutaActiva() {
        const id = this.idActivo();
        return id ? (this.#catalogo.query("SELECT ruta FROM bancos WHERE id = ?").get(id)?.ruta ?? null) : null;
    }

    /** Abre (una sola vez) el banco activo y devuelve el repo. Falla claro si falta el archivo. */
    abrirActivo() {
        if (this.#abierto) return this.#abierto.repo;
        const id = this.idActivo();
        if (!id) throw new Error("No hay banco activo: elige uno del catálogo primero.");
        const fila = this.#catalogo.query("SELECT ruta FROM bancos WHERE id = ?").get(id);
        if (!fila) throw new Error(`El banco activo (id ${id}) ya no está en el catálogo.`);
        /* abrirDb crearía el archivo vacío; un banco ausente debe ser un error, no una base nueva en silencio. */
        if (!existsSync(fila.ruta))
            throw new Error(`El banco activo «${fila.ruta}» no está accesible (ruta ausente o desconectada).`);
        this.#abierto = { id, repo: abrirDb(fila.ruta) };
        return this.#abierto.repo;
    }

    /** Cierra el banco abierto (si lo hay); el banco activo no cambia. */
    cerrar() {
        if (!this.#abierto) return;
        const { repo } = this.#abierto;
        this.#abierto = null;
        repo.close();
    }

    /** Cierra banco y catálogo. Tras esto el gestor no se puede usar. */
    close() {
        this.cerrar();
        this.#catalogo.close();
    }
}
