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
import { idBanco } from "./banco-id.js";
import { abrirRepo } from "./db/index.js";
import { errorDeVerificacion, verificarBanco } from "./db/validar-sqlite.js";
import { exportarBanco } from "./portable.js";
import { detectarArchivo, fuenteDeJson } from "./banco-archivo.js";
import { fuenteMemoria } from "./fuente.js";
import { fuenteDirectorio } from "./fuente-directorio.js";
import { importarFuente } from "./seed.js";
import { importarDirectorio } from "./seed-directorio.js";

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
        /* Catálogos creados antes de F2.7: añade las columnas de metadatos si faltan. */
        for (const [col, tipo] of [
            ["origen", "TEXT"],
            ["tam_bytes", "INTEGER"],
            ["preguntas", "INTEGER"],
            ["version_banco", "INTEGER"],
            ["ultima_vez", "TEXT"],
            ["uuid_banco", "TEXT"], // F3.5: detección de duplicados en el asistente de importación
        ])
            try {
                this.#catalogo.run(`ALTER TABLE bancos ADD COLUMN ${col} ${tipo}`);
            } catch {
                /* la columna ya existía */
            }
    }

    /** Registra un banco SQLite existente. Ruta y nombre deben ser únicos y el banco válido. */
    async registrar(nombre, ruta) {
        if (!ruta.trim()) throw new Error("Indica la ruta del banco.");
        if (!(await this.#almacen.existe(ruta)))
            throw new Error(`El banco «${ruta}» no existe. Registra una SQLite existente o copia primero el archivo.`);
        /* Validar ANTES de anotarlo en el catálogo: un banco inválido no entra nunca (F2.4). */
        const info = await this.#verificar(ruta);
        const tam_bytes = (await this.#almacen.leer(ruta)).length;
        const meta = {
            origen: "registrado",
            tam_bytes,
            preguntas: info.preguntas,
            version_banco: info.user_version,
            uuid_banco: info.uuid,
        };
        const fila = await this.#insertar(nombre.trim(), ruta, meta);
        return { id: fila.lastInsertRowid, nombre: nombre.trim(), ruta, ...meta };
    }

    /** Crea un banco nuevo importando un directorio JSON (misma estructura que el seed).
        Se construye en un temporal y se renombra: el banco aparece completo o no aparece. */
    async importarJson(nombre, dirPreguntas) {
        return this.#crearDesdeFuente(nombre, fuenteDirectorio(dirPreguntas), { estricto: true });
    }

    /* Crea un banco nuevo desde una `fuente` (directorio en PC, JSON en memoria para el
       asistente de importación). Con `estricto` falla si el nombre o la ruta ya existen
       (semántica del CLI); sin él, busca un nombre libre añadiendo « (2)», « (3)»… */
    async #crearDesdeFuente(nombre, fuente, { estricto = false } = {}) {
        const { nombre: nombreLibre, ruta } = estricto
            ? { nombre: String(nombre).trim(), ruta: await this.rutaDestino(nombre) }
            : await this.#rutaLibre(nombre);
        const temporal = ruta + ".tmp";
        await this.#quitarSiExiste(temporal);
        const repo = abrirRepo(await this.#driver.abrir(this.#almacen, temporal));
        let bytes;
        try {
            const r = await importarFuente(repo, fuente);
            if (r.errores.length)
                throw new Error(
                    `Importación con errores (${r.errores.length}); banco no creado. Primera: ${r.errores[0]}`,
                );
            /* Marca el banco nuevo con su uuid en `ajustes` (detección de duplicados, F2.7). */
            idBanco(repo);
            bytes = this.#driver.instantanea(repo.db);
        } catch (e) {
            await this.#quitarSiExiste(temporal);
            throw e;
        } finally {
            repo.close();
        }
        await this.#almacen.escribir(temporal, bytes); // el driver WASM no escribe solo
        return await this.#anotar(nombreLibre, temporal, ruta, "importado", bytes.length);
    }

    /* Primer nombre libre con su ruta: «X», «X (2)», «X (3)»… hasta que el nombre no esté
       en el catálogo y su archivo no exista (F3.5, «importar como nuevo» de un duplicado). */
    async #rutaLibre(nombre) {
        const base = String(nombre ?? "").trim() || "Banco importado";
        for (let n = 1; ; n++) {
            const candidato = n === 1 ? base : `${base} (${n})`;
            let ruta = null;
            try {
                ruta = await this.rutaDestino(candidato);
            } catch {
                /* el archivo ya existe: probamos el siguiente sufijo */
            }
            if (ruta && !this.#catalogo.query("SELECT 1 FROM bancos WHERE nombre = ? COLLATE NOCASE").get(candidato))
                return { nombre: candidato, ruta };
        }
    }

    /** Copia un banco SQLite existente al catálogo (el original queda intacto y registrado
        donde estaba). Copia a temporal + valida + renombra: nunca queda un banco a medias. */
    async copiar(nombre, rutaOrigen) {
        if (!(await this.#almacen.existe(rutaOrigen))) throw new Error(`No existe el banco «${rutaOrigen}».`);
        const ruta = await this.rutaDestino(nombre);
        const temporal = ruta + ".tmp";
        await this.#quitarSiExiste(temporal);
        try {
            const bytes = await this.#almacen.leer(rutaOrigen);
            await this.#almacen.escribir(temporal, bytes);
            return await this.#anotar(nombre, temporal, ruta, "copiado", bytes.length);
        } catch (e) {
            await this.#quitarSiExiste(temporal);
            throw e;
        }
    }

    /* Verifica el temporal (F2.4), lo renombra a su lugar definitivo y lo anota en el catálogo
       con sus metadatos (F2.7). Si algo falla, no queda ni temporal ni banco a medias. */
    async #anotar(nombre, temporal, ruta, origen, tamBytes) {
        try {
            const info = await this.#verificar(temporal);
            await this.#limpiarLados(temporal);
            await this.#almacen.renombrar(temporal, ruta); // atómico dentro del mismo directorio
            const meta = {
                origen,
                tam_bytes: tamBytes,
                preguntas: info.preguntas,
                version_banco: info.user_version,
                uuid_banco: info.uuid,
            };
            const fila = await this.#insertar(nombre.trim(), ruta, meta);
            return { id: fila.lastInsertRowid, nombre: nombre.trim(), ruta, ...meta };
        } catch (e) {
            await this.#quitarSiExiste(temporal);
            await this.#quitarSiExiste(ruta); // si falló el INSERT tras renombrar, no queda huérfano
            throw e;
        }
    }

    /* Abre la ruta solo lectura y pasa el filtro único de banco Opios (F2.4). */
    async #verificar(ruta) {
        const db = await this.#driver.abrir(this.#almacen, ruta, { readonly: true });
        try {
            return verificarBanco(db);
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

    /** Actualiza el banco `id` desde un directorio JSON (task 9, F3.1): en sitio, conservando
        ids internos y progreso mediante `id_externo` (y la deduplicación por enunciado).
        Nunca reemplaza el archivo: primero valida el directorio con una importación de
        ensayo en memoria y, si hay errores, aborta sin tocar el banco. Si el banco a
        actualizar no es el abierto, se cierra el abierto (flush) y se reabre al terminar. */
    async actualizar(id, dirPreguntas) {
        await this.#listo;
        const fila = this.#catalogo.query("SELECT ruta FROM bancos WHERE id = ?").get(id);
        if (!fila) throw new Error(`El banco ${id} no está en el catálogo.`);
        if (!(await this.#almacen.existe(fila.ruta)))
            throw new Error(`El banco «${fila.ruta}» no está accesible (ruta ausente o desconectada).`);
        const abierto = this.#abierto;
        const esElAbierto = abierto && abierto.id === id;
        if (abierto && !esElAbierto) await this.cerrar(); // libera la única conexión de banco
        const repo = esElAbierto ? abierto.repo : abrirRepo(await this.#driver.abrir(this.#almacen, fila.ruta));
        let r;
        try {
            /* Ensayo en RAM: `:memory:` es banco nuevo para bun:sqlite y para sql.js. */
            const ensayo = abrirRepo(await this.#driver.abrir(this.#almacen, ":memory:"));
            try {
                r = await importarDirectorio(ensayo, dirPreguntas, { actualizar: true });
            } finally {
                ensayo.close();
            }
            if (r.errores.length)
                throw new Error(
                    `El directorio tiene ${r.errores.length} error(es); banco sin tocar. Primero: ${r.errores[0]}`,
                );
            r = await importarDirectorio(repo, dirPreguntas, { actualizar: true });
            /* Persiste el resultado (el driver WASM no escribe solo) y actualiza metadatos (F2.7). */
            const bytes = this.#driver.instantanea(repo.db);
            await this.#almacen.escribir(fila.ruta, bytes);
            this.#catalogo
                .query("UPDATE bancos SET tam_bytes = ?, preguntas = ?, version_banco = ?, uuid_banco = ? WHERE id = ?")
                .run(
                    bytes.length,
                    repo.db.query("SELECT COUNT(*) AS n FROM preguntas").get().n,
                    repo.db.query("PRAGMA user_version").get().user_version,
                    repo.ajustes().uuid_banco ?? null,
                    id,
                );
            r = { ...r, banco: fila.ruta };
        } finally {
            if (!esElAbierto) repo.close();
        }
        /* Reabre el banco activo que se cerró para actualizar otro. */
        if (abierto && !esElAbierto) await this.abrirActivo();
        return r;
    }

    /** Actualiza el banco activo (compatibilidad con el CLI). */
    async actualizarActivo(dirPreguntas) {
        const id = await this.idActivo();
        if (!id) throw new Error("No hay banco activo: elige uno del catálogo primero.");
        return this.actualizar(id, dirPreguntas);
    }

    async listar() {
        await this.#listo;
        const activo = await this.idActivo();
        return this.#catalogo
            .query(
                "SELECT id, nombre, ruta, origen, tam_bytes, preguntas, version_banco, ultima_vez " +
                    "FROM bancos ORDER BY nombre COLLATE NOCASE, id",
            )
            .all()
            .map((b) => ({ ...b, activo: b.id === activo }));
    }

    async idActivo() {
        await this.#listo;
        return Number(this.#catalogo.query("SELECT valor FROM estado WHERE clave = 'activo'").get()?.valor) || null;
    }

    /** Elige el banco activo (F2.8): flush y cierre del abierto antes de tocar el catálogo;
        el abrir del nuevo y la recarga de `__opios`/UI los hace quien llama tras activar. */
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
        this.#catalogo.query("UPDATE bancos SET ultima_vez = ? WHERE id = ?").run(new Date().toISOString(), id);
    }

    /** Ruta del banco activo (sin abrirlo). */
    async rutaActiva() {
        const id = await this.idActivo();
        return id ? (this.#catalogo.query("SELECT ruta FROM bancos WHERE id = ?").get(id)?.ruta ?? null) : null;
    }

    /** Nombre del banco activo (para la cabecera, F3.3), sin abrirlo. */
    async nombreActivo() {
        const id = await this.idActivo();
        return id ? (this.#catalogo.query("SELECT nombre FROM bancos WHERE id = ?").get(id)?.nombre ?? null) : null;
    }

    /** Empaqueta el banco `id` en bytes .opios (F2.5). El activo usa su conexión abierta;
        los demás se leen con una conexión solo lectura puntual (no toca la conexión única). */
    async exportar(id) {
        await this.#listo;
        const fila = this.#catalogo.query("SELECT nombre, ruta FROM bancos WHERE id = ?").get(id);
        if (!fila) throw new Error(`El banco ${id} no está en el catálogo.`);
        if (this.#abierto && this.#abierto.id === id)
            return exportarBanco(this.#driver, this.#abierto.repo.db, { nombre: fila.nombre });
        if (!(await this.#almacen.existe(fila.ruta)))
            throw new Error(`El banco «${fila.ruta}» no está accesible (ruta ausente o desconectada).`);
        const db = await this.#driver.abrir(this.#almacen, fila.ruta, { readonly: true });
        try {
            return await exportarBanco(this.#driver, db, { nombre: fila.nombre });
        } finally {
            db.close();
        }
    }

    /** Cambia el nombre en el catálogo (F3.1). El archivo no se mueve: la ruta es interna. */
    async renombrar(id, nombre) {
        await this.#listo;
        const limpio = String(nombre ?? "").trim();
        if (!limpio) throw new Error("El nombre no puede estar vacío.");
        if (!this.#catalogo.query("SELECT 1 FROM bancos WHERE id = ?").get(id))
            throw new Error(`El banco ${id} no está en el catálogo.`);
        if (this.#catalogo.query("SELECT 1 FROM bancos WHERE nombre = ? COLLATE NOCASE AND id != ?").get(limpio, id))
            throw new Error(`Ya existe un banco llamado «${limpio}».`);
        this.#catalogo.query("UPDATE bancos SET nombre = ? WHERE id = ?").run(limpio, id);
        return { id, nombre: limpio };
    }

    /** Elimina un banco del catálogo y borra su archivo y sidecars. Nunca el activo:
        quien quiera borrarlo debe activar otro primero (nunca se queda sin banco). */
    async borrar(id) {
        await this.#listo;
        if (id === (await this.idActivo()))
            throw new Error("No se puede borrar el banco activo: activa otro banco primero.");
        const fila = this.#catalogo.query("SELECT ruta FROM bancos WHERE id = ?").get(id);
        if (!fila) throw new Error(`El banco ${id} no está en el catálogo.`);
        this.#catalogo.query("DELETE FROM bancos WHERE id = ?").run(id);
        for (const lado of ["", "-wal", "-shm"]) await this.#almacen.borrar(fila.ruta + lado);
        return true;
    }

    /* --- Asistente de importación (F3.4/F3.5) --- */

    /** Previsualiza un archivo importable (.opios, SQLite o JSON) sin tocar el catálogo ni
        ningún banco: valida y cuenta. Devuelve `duplicado` si ya está en el catálogo (F3.5). */
    async inspeccionar(bytes, { nombre = "" } = {}) {
        const arch = await detectarArchivo(bytes);
        if (arch.tipo === "zip")
            return {
                tipo: "zip",
                soportado: false,
                mensaje:
                    "Los .zip se importarán con la versión para Android (F4). Descomprímelo e importa su carpeta (bun run bancos importar) o sus JSON aquí.",
                duplicado: null,
                errores: [],
                avisos: [],
            };
        let base;
        if (arch.tipo === "json") {
            /* Importación de ensayo en memoria: los mismos errores que la real, sin tocar nada. */
            const ensayo = abrirRepo(await this.#driver.abrir(this.#almacen, ":memory:"));
            try {
                const r = await importarFuente(ensayo, fuenteDeJson(arch.texto));
                base = {
                    tipo: "json",
                    preguntas: r.nuevas,
                    duplicadas: r.duplicadas,
                    errores: r.errores,
                    avisos: r.avisos,
                };
            } finally {
                ensayo.close();
            }
        } else {
            const temporal = juntoA(
                this.#rutaCatalogo,
                `inspeccion-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
            );
            try {
                await this.#almacen.escribir(temporal, arch.sqlite);
                const db = await this.#driver.abrir(this.#almacen, temporal, { readonly: true });
                let info;
                try {
                    info = verificarBanco(db);
                } catch (e) {
                    throw errorDeVerificacion(e, "el archivo importado");
                } finally {
                    db.close();
                }
                base = {
                    tipo: arch.tipo,
                    manifest: arch.manifest ?? null,
                    preguntas: info.preguntas,
                    version_banco: info.user_version,
                    uuid: info.uuid,
                    errores: [],
                    avisos: [],
                };
            } finally {
                await this.#quitarSiExiste(temporal);
            }
        }
        const duplicado = await this.#duplicadoDe(base.uuid ?? null, nombre || base.manifest?.nombre || null);
        return { ...base, duplicado };
    }

    /** ¿Ya está este banco en el catálogo? Por uuid_banco primero, luego por nombre (F3.5). */
    async #duplicadoDe(uuid, nombre) {
        if (uuid) {
            const fila = this.#catalogo.query("SELECT id, nombre FROM bancos WHERE uuid_banco = ?").get(uuid);
            if (fila) return { ...fila, por: "uuid" };
        }
        const limpio = String(nombre ?? "").trim();
        if (limpio) {
            const fila = this.#catalogo
                .query("SELECT id, nombre FROM bancos WHERE nombre = ? COLLATE NOCASE")
                .get(limpio);
            if (fila) return { ...fila, por: "nombre" };
        }
        return null;
    }

    /** Importa el archivo detectado (F3.4). modo "nuevo": crea un banco (nombre auto-ajustado
        a «X (2)» si choca). modo "actualizar": fusiona por id_externo en el banco `id`. */
    async importarBytes(bytes, { nombre = "", modo = "nuevo", id = null } = {}) {
        const arch = await detectarArchivo(bytes);
        if (arch.tipo === "zip")
            throw new Error(
                "La importación de .zip llegará con la versión para Android (F4). Descomprímelo e importa su carpeta o sus JSON.",
            );
        if (modo === "actualizar") return await this.#fusionar(arch, id);
        if (arch.tipo === "json")
            return await this.#crearDesdeFuente(nombre.trim() || "Importado", fuenteDeJson(arch.texto));
        const { nombre: nombreLibre, ruta } = await this.#rutaLibre(nombre.trim() || "Importado");
        const temporal = ruta + ".tmp";
        try {
            await this.#almacen.escribir(temporal, arch.sqlite);
            return await this.#anotar(nombreLibre, temporal, ruta, "importado", arch.sqlite.length);
        } catch (e) {
            await this.#quitarSiExiste(temporal);
            throw e;
        }
    }

    /** Fusiona el archivo en el banco `id` (D2): actualiza por id_externo conservando ids y
        progreso, salta las repetidas por enunciado y no borra nada (archivar es de F5, D3). */
    async #fusionar(arch, id) {
        await this.#listo;
        const fila = this.#catalogo.query("SELECT ruta, nombre FROM bancos WHERE id = ?").get(id);
        if (!fila) throw new Error(`El banco ${id} no está en el catálogo.`);
        if (!(await this.#almacen.existe(fila.ruta)))
            throw new Error(`El banco «${fila.ruta}» no está accesible (ruta ausente o desconectada).`);
        const abierto = this.#abierto;
        const esElAbierto = abierto && abierto.id === id;
        if (abierto && !esElAbierto) await this.cerrar(); // libera la única conexión de banco
        const repo = esElAbierto ? abierto.repo : abrirRepo(await this.#driver.abrir(this.#almacen, fila.ruta));
        let r;
        try {
            if (arch.tipo === "json") {
                const fuente = fuenteDeJson(arch.texto);
                /* Ensayo en memoria: si el archivo tiene errores, el banco no se toca. */
                const ensayo = abrirRepo(await this.#driver.abrir(this.#almacen, ":memory:"));
                try {
                    const e = await importarFuente(ensayo, fuente, { actualizar: true });
                    if (e.errores.length)
                        throw new Error(
                            `El archivo tiene ${e.errores.length} error(es); banco sin tocar. Primera: ${e.errores[0]}`,
                        );
                } finally {
                    ensayo.close();
                }
                r = await importarFuente(repo, fuente, { actualizar: true });
            } else {
                const temporal = juntoA(
                    this.#rutaCatalogo,
                    `fusion-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
                );
                try {
                    await this.#almacen.escribir(temporal, arch.sqlite);
                    /* Copia temporal en lectura-escritura: así abrirRepo puede migrarla (versión
                       antigua) sin tocar el original; una versión futura lanza el error claro. */
                    const fuenteDb = await this.#driver.abrir(this.#almacen, temporal);
                    let lista;
                    try {
                        let fuenteRepo;
                        try {
                            fuenteRepo = abrirRepo(fuenteDb);
                        } catch (e) {
                            throw errorDeVerificacion(e, "el archivo importado");
                        }
                        try {
                            lista = fuenteRepo.todas().map((p) => ({
                                /* Del banco fuente sale el id interno de su tema/bloque: para
                                   fusionar manda la numeración (tema_N dentro de bloque_N). */
                                pregunta: p.pregunta,
                                respuestas: p.respuestas,
                                correcta: p.correcta,
                                explicacion: p.explicacion,
                                id_externo: p.id_externo,
                                bloque: p.bloque_nombre,
                                bloque_numero: p.bloque_numero,
                                tema: p.tema_numero,
                                tema_numero: p.tema_numero,
                            }));
                        } finally {
                            fuenteRepo.close();
                        }
                    } finally {
                        fuenteDb.close();
                    }
                    r = await repo.importar(lista, { actualizar: true });
                } finally {
                    await this.#quitarSiExiste(temporal);
                }
            }
            const bytes = this.#driver.instantanea(repo.db);
            await this.#almacen.escribir(fila.ruta, bytes);
            this.#catalogo
                .query("UPDATE bancos SET tam_bytes = ?, preguntas = ?, version_banco = ?, uuid_banco = ? WHERE id = ?")
                .run(
                    bytes.length,
                    repo.db.query("SELECT COUNT(*) AS n FROM preguntas").get().n,
                    repo.db.query("PRAGMA user_version").get().user_version,
                    repo.ajustes().uuid_banco ?? null,
                    id,
                );
            r = { ...r, banco: fila.ruta, nombre: fila.nombre };
        } finally {
            if (!esElAbierto) repo.close();
        }
        /* Reabre el banco activo que se cerró para fusionar en otro. */
        if (abierto && !esElAbierto) await this.abrirActivo();
        return r;
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
        this.#abierto = {
            id,
            ruta: fila.ruta,
            repo: abrirRepo(await this.#driver.abrir(this.#almacen, fila.ruta)),
        };
        /* Garantiza uuid_banco en ajustes de cada banco abierto (detección de duplicados, F2.7). */
        idBanco(this.#abierto.repo);
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

    async #insertar(nombre, ruta, meta) {
        await this.#listo;
        return this.#catalogo
            .query(
                "INSERT INTO bancos (nombre, ruta, origen, tam_bytes, preguntas, version_banco, uuid_banco) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
                nombre,
                ruta,
                meta.origen,
                meta.tam_bytes,
                meta.preguntas,
                meta.version_banco,
                meta.uuid_banco ?? null,
            ); // el UNIQUE de la tabla lanza con un error claro
    }
}
