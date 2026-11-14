/* Adaptador SQLite para el WebView (task 11). Implementa la porción del API de Bun SQLite
   que usa src/db/*.js — query().get/.all/.run, run, transaction, close — sobre sql.js
   (SQLite WASM, síncrona). Nada de este archivo puede depender de Bun: también corre en
   el WebView de Android. La persistencia es explícita: `onCambios` se avisa tras cada
   escritura y quien llama guarda `exportar()` donde quiera (en Android, Filesystem). */
import initSqlJs from "sql.js";

let inicializado = null;
const sqlJs = (rutaWasm) => (inicializado ??= initSqlJs({ locateFile: () => rutaWasm }));

/** Convierte los bytes del banco a base64 (Filesystem lo escribe como binario). */
export function aBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

/** Inverso de `aBase64`. */
export function deBase64(texto) {
    const s = atob(texto);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
}

/** Abre (o crea) la base de datos. `bytes` restaura un banco guardado; `onCambios(shim)`
    se avisa tras cada escritura para persistir con `exportar()`. */
export async function abrirAdaptadorSqlite({ bytes = null, onCambios = () => {}, rutaWasm = "sql-wasm.wasm" } = {}) {
    const SQL = await sqlJs(rutaWasm);
    const db = new SQL.Database(bytes ? deBase64TextSiHaceFalta(bytes) : undefined);
    let cerrada = false;
    const avisar = () => {
        if (!cerrada) onCambios(shim);
    };

    /* Sentencia con el mismo contrato que Bun: run devuelve { changes, lastInsertRowid }. */
    function sentencia(sql) {
        return {
            get(...params) {
                const s = db.prepare(sql);
                try {
                    if (params.length) s.bind(params);
                    return s.step() ? s.getAsObject() : undefined;
                } finally {
                    s.free();
                }
            },
            all(...params) {
                const s = db.prepare(sql);
                try {
                    if (params.length) s.bind(params);
                    const filas = [];
                    while (s.step()) filas.push(s.getAsObject());
                    return filas;
                } finally {
                    s.free();
                }
            },
            run(...params) {
                const s = db.prepare(sql);
                try {
                    if (params.length) s.bind(params);
                    s.step();
                } finally {
                    s.free();
                }
                const changes = db.getRowsModified();
                const resultado = { changes };
                /* Solo los INSERT aportan rowid nuevo: en UPDATE sería el de otro INSERT anterior. */
                if (changes > 0 && /^\s*INSERT/i.test(sql))
                    resultado.lastInsertRowid = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
                avisar();
                return resultado;
            },
        };
    }

    const shim = {
        query: (sql) => sentencia(sql),
        run: (sql) => {
            /* Sin params: ejecuta SQL múltiple (migraciones, PRAGMAs, VACUUM INTO). */
            const r = db.run(sql);
            avisar();
            return r;
        },
        transaction: (fn) =>
            (...args) => {
                db.run("BEGIN");
                try {
                    const r = fn(...args);
                    db.run("COMMIT");
                    avisar();
                    return r;
                } catch (e) {
                    try {
                        db.run("ROLLBACK");
                    } catch {
                        /* la transacción ya no existe */
                    }
                    throw e;
                }
            },
        exportar: () => db.export(),
        close: () => {
            cerrada = true;
            db.close();
        },
    };
    return shim;
}

/* Filesystem.readFile devuelve base64; si nos pasan texto base64 lo decodificamos aquí. */
function deBase64TextSiHaceFalta(bytes) {
    return typeof bytes === "string" ? deBase64(bytes) : bytes;
}
