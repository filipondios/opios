/* DatabaseManager (task 5 del TODO, F2.3): catálogo de bancos de preguntas + banco activo.
   Neutro de plataforma: el catálogo y cada banco se abren con un `driver` (bun:sqlite en
   PC, sql.js en el WebView) a través de un `almacén` (node:fs o Filesystem de Capacitor);
   aquí no se importa ni bun:sqlite ni node:fs. El catálogo es una SQLite pequeña con la
   lista de bancos y su ruta; el progreso vive dentro de cada banco (cada SQLite). Solo
   hay una conexión de banco abierta a la vez: se cierra antes de abrir otra (riesgo del
   TODO: evitar cambiar de banco durante una sesión). El modo directo `OPIOS_DB` sigue
   siendo legacy y no pasa por aquí.
   shortcut: el catálogo solo se persiste al cerrar (instantánea al almacén); si el proceso
   muere sin close() se pierden los cambios de catálogo desde el arranque. Los bancos van
   write-through con el driver de Bun; para catálogo vivo, F2.7/2.8. */
import { comprobarAlmacen } from "./almacen.js";
import { comprobarDriver } from "./driver.js";
import { abrirRepo } from "./db/index.js";
import { errorDeVerificacion, verificarBanco } from "./db/validar-sqlite.js";
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

/** Junta `nombre` a la carpeta de `ruta` (equivale a join(dirname(ruta), nombre), sin node:path). */
const juntoA = (ruta, nombre) => {
    const i = ruta.lastIndexOf("/");
    return i < 0 ? nombre : ruta.slice(0, i + 1) + nombre;
};

export class DatabaseManager {
    #almacen;
    #driver;
    #rutaCatalogo;
    #catalogo = null;
    #listo; // promesa de apertura del catálogo: todos los métodos la esperan
    #abierto = null; // { id, ruta, repo } del banco con la conexión abierta, o null

    constructor({ almacen, driver, rutaCatalogo }) {
        comprobarAlmacen(almacen);
        comprobarDriver(driver);
        this.#almacen = almacen;
        this.#driver = driver;
        this.#rutaCatalogo = rutaCatalogo;
        this.#listo = this.#abrirCatalogo();
    }

    async #abrirCatalogo() {
        if (this.#rutaCatalogo !== ":memory:" && !(await this.#almacen.existe(this.#rutaCatalogo)))
            await this.#almacen.escribir(this.#rutaCatalogo, new Uint8Array(0)); // crea también las carpetas
        this.#catalogo = await this.#driver.abrir(this.#almacen, this.#rutaCatalogo);
        this.#catalogo.run("PRAGMA foreign_keys = ON");
        this.#catalogo.run(ESQUEMA);
    }

    /** Registra un banco SQLite existente. Ruta y nombre deben ser únicos y el banco válido. */
    async registrar(nombre, ruta) {
        if (!ruta.trim()) throw new Error("Indica la ruta del banco.");
        if (!(await this.#almacen.existe(ruta)))
            throw new Error(`El banco «${ruta}» no existe. Registra una SQLite existente o copia primero el archivo.`);
        /* Validar ANTES de anotarlo en el catálogo: un banco inválido no entra nunca (F2.4). */
        await this.#verificar(ruta);
        const fila = await this.#insertar(nombre.trim(), ruta);
        return { id: fila.lastInsertRowid, nombre: nombre.trim(), ruta };
    }

    /** Crea un banco nuevo importando un directorio JSON (misma estructura que el seed).
        Se construye en un temporal y se renombra: el banco aparece completo o no aparece. */
    async importarJson(nombre, dirPreguntas) {
        const ruta = await this.rutaDestino(nombre);
        const temporal = ruta + ".tmp";
        await this.#quitarSiExiste(temporal);
        const repo = abrirRepo(await this.#driver.abrir(this.#almacen, temporal));
        let bytes;
        try {
            const r = await importarDirectorio(repo, dirPreguntas);
            if (r.errores.length)
                throw new Error(
                    `Importación con errores (${r.errores.length}); banco no creado. Primera: ${r.errores[0]}`,
                );
            bytes = this.#driver.instantanea(repo.db);
        } catch (e) {
            await this.#quitarSiExiste(temporal);
            throw e;
        } finally {
            repo.close();
        }
        await this.#almacen.escribir(temporal, bytes); // el driver WASM no escribe solo
        return await this.#anotar(nombre, temporal, ruta);
    }

    /** Copia un banco SQLite existente al catálogo (el original queda intacto y registrado
        donde estaba). Copia a temporal + valida + renombra: nunca queda un banco a medias. */
    async copiar(nombre, rutaOrigen) {
        if (!(await this.#almacen.existe(rutaOrigen))) throw new Error(`No existe el banco «${rutaOrigen}».`);
        const ruta = await this.rutaDestino(nombre);
        const temporal = ruta + ".tmp";
        await this.#quitarSiExiste(temporal);
        try {
            await this.#almacen.escribir(temporal, await this.#almacen.leer(rutaOrigen));
        } catch (e) {
            await this.#quitarSiExiste(temporal);
            throw e;
        }
        return await this.#anotar(nombre, temporal, ruta);
    }

    /* Verifica el temporal (F2.4), lo renombra a su lugar definitivo y lo anota en el catálogo. */
    async #anotar(nombre, temporal, ruta) {
        try {
            await this.#verificar(temporal);
            await this.#limpiarLados(temporal);
            await this.#almacen.renombrar(temporal, ruta); // atómico dentro del mismo directorio
        } catch (e) {
            await this.#quitarSiExiste(temporal);
            throw e;
        }
        const fila = await this.#insertar(nombre.trim(), ruta);
        return { id: fila.lastInsertRowid, nombre: nombre.trim(), ruta };
    }

    /* Abre la ruta solo lectura y pasa el filtro único de banco Opios (F2.4). */
    async #verificar(ruta) {
        const db = await this.#driver.abrir(this.#almacen, ruta, { readonly: true });
        try {
            verificarBanco(db);
        } catch (e) {
            throw errorDeVerificacion(e, ruta);
        } finally {
            db.close();
        }
    }

    /* El renombrar solo mueve el .db: los sidecars WAL/SHM del temporal quedarían huérfanos. */
    #limpiarLados(ruta) {
        return Promise.all(["-wal", "-shm"].map((lado) => this.#almacen.borrar(ruta + lado)));
    }

    /* Borrar una ruta y sus posibles sidecars: un temporal futuro no debe "recuperar" nada. */
    async #quitarSiExiste(ruta) {
        if (!(await this.#almacen.existe(ruta))) return;
        await this.#almacen.borrar(ruta);
        await this.#limpiarLados(ruta);
    }

    /** Ruta definitiva de un banco nuevo (junto al catálogo). Falla si ya existe. */
    async rutaDestino(nombre) {
        const limpio = String(nombre)
            .trim()
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "");
        if (!limpio) throw new Error("Nombre de banco no válido.");
        const ruta = juntoA(this.#rutaCatalogo, `${limpio}.db`);
        if (await this.#almacen.existe(ruta)) throw new Error(`Ya existe ${ruta}; elige otro nombre.`);
        return ruta;
    }

    /** Actualiza el banco activo desde un directorio JSON (task 9): en sitio, conservando
        ids internos y progreso mediante `id_externo` (y la deduplicación por enunciado).
        Nunca reemplaza el archivo: primero valida el directorio con una importación de
        ensayo en memoria y, si hay errores, aborta sin tocar el banco. */
    async actualizarActivo(dirPreguntas) {
        const repo = await this.abrirActivo();
        /* Ensayo en RAM: `:memory:` es banco nuevo para bun:sqlite y para sql.js. */
        const ensayo = abrirRepo(await this.#driver.abrir(this.#almacen, ":memory:"));
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
        return { ...final, banco: await this.rutaActiva() };
    }

    async listar() {
        await this.#listo;
        const activo = await this.idActivo();
        return this.#catalogo
            .query("SELECT id, nombre, ruta FROM bancos ORDER BY nombre COLLATE NOCASE, id")
            .all()
            .map((b) => ({ ...b, activo: b.id === activo }));
    }

    async idActivo() {
        await this.#listo;
        return Number(this.#catalogo.query("SELECT valor FROM estado WHERE clave = 'activo'").get()?.valor) || null;
    }

    /** Elige el banco activo; cierra el que estuviera abierto (nunca dos conexiones a la vez). */
    async activar(id) {
        await this.#listo;
        if (!this.#catalogo.query("SELECT 1 FROM bancos WHERE id = ?").get(id))
            throw new Error(`El banco ${id} no está en el catálogo.`);
        await this.cerrar();
        this.#catalogo
            .query(
                "INSERT INTO estado (clave, valor) VALUES ('activo', ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor",
            )
            .run(String(id));
    }

    /** Ruta del banco activo (sin abrirlo). */
    async rutaActiva() {
        const id = await this.idActivo();
        return id ? (this.#catalogo.query("SELECT ruta FROM bancos WHERE id = ?").get(id)?.ruta ?? null) : null;
    }

    /** Abre (una sola vez) el banco activo y devuelve el repo. Falla claro si falta el archivo. */
    async abrirActivo() {
        if (this.#abierto) return this.#abierto.repo;
        const id = await this.idActivo();
        if (!id) throw new Error("No hay banco activo: elige uno del catálogo primero.");
        const fila = this.#catalogo.query("SELECT ruta FROM bancos WHERE id = ?").get(id);
        if (!fila) throw new Error(`El banco activo (id ${id}) ya no está en el catálogo.`);
        /* Abrir sin el archivo crearía una base nueva en silencio: un banco ausente es un error. */
        if (!(await this.#almacen.existe(fila.ruta)))
            throw new Error(`El banco activo «${fila.ruta}» no está accesible (ruta ausente o desconectada).`);
        this.#abierto = { id, ruta: fila.ruta, repo: abrirRepo(await this.#driver.abrir(this.#almacen, fila.ruta)) };
        return this.#abierto.repo;
    }

    /** Cierra el banco abierto (si lo hay) persistiéndolo; el banco activo no cambia. */
    async cerrar() {
        if (!this.#abierto) return;
        const { ruta, repo } = this.#abierto;
        this.#abierto = null;
        let bytes = null;
        try {
            bytes = this.#driver.instantanea(repo.db);
        } catch {
            /* la conexión ya estaba cerrada (p. ej. repo.close() del servidor): nada que persistir */
        }
        try {
            repo.close();
        } catch {
            /* ya estaba cerrada */
        }
        if (bytes) await this.#almacen.escribir(ruta, bytes);
    }

    /** Cierra banco y catálogo, persistiendo el catálogo (imprescindible con sql.js, que no
        escribe solo en el almacén). Tras esto el gestor no se puede usar. */
    async close() {
        await this.cerrar();
        try {
            await this.#listo;
        } catch {
            return; // el catálogo nunca llegó a abrirse
        }
        const catalogo = this.#catalogo;
        this.#catalogo = null;
        if (!catalogo) return;
        const bytes = this.#rutaCatalogo === ":memory:" ? null : this.#driver.instantanea(catalogo);
        catalogo.close();
        if (bytes) await this.#almacen.escribir(this.#rutaCatalogo, bytes);
    }

    async #insertar(nombre, ruta) {
        await this.#listo;
        return this.#catalogo.query("INSERT INTO bancos (nombre, ruta) VALUES (?, ?)").run(nombre, ruta); // el UNIQUE de la tabla lanza con un error claro
    }
}
