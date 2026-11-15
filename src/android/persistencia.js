/* Persistencia del banco en Android (F1.4): escritura atómica (temporal + rotación de la copia
   anterior), guardado con debounce y volcado inmediato al pasar a segundo plano. El almacén y
   el comprobador de integridad se inyectan para poder probarlo sin Capacitor ni sql.js. */

const RETARDO_MS = 400;

/**
 * Gestor de persistencia.
 * - `almacen`: `{ existe, leer→Uint8Array, escribir, renombrar, borrar }` (rutas relativas al Data).
 * - `ruta`: archivo canónico del banco.
 * - `exportar()`: bytes actuales del banco (sql.js `export()`).
 * - `integro(bytes)`: promesa que dice si los bytes son un SQLite válido.
 */
export function crearPersistencia({ almacen, ruta, exportar, integro, retardo = RETARDO_MS, aviso = () => {} }) {
    const tmp = `${ruta}.tmp`;
    const prev = `${ruta}.prev`;
    let cadena = Promise.resolve(); // una escritura a la vez sobre los mismos archivos
    let temporizador = null;
    let sucio = false;

    const valido = async (p) => {
        if (!(await almacen.existe(p))) return false;
        try {
            return await integro(await almacen.leer(p));
        } catch {
            return false;
        }
    };

    /* Escritura atómica: temporal -> (canónico a `.prev`) -> canónico. Así nunca se reescribe el
       canónico en sitio y, pase lo que pase, sobrevive un archivo válido. */
    const guardar = async () => {
        const bytes = exportar();
        await almacen.escribir(tmp, bytes);
        if (await almacen.existe(ruta)) {
            try {
                await almacen.borrar(prev);
            } catch {
                /* no había copia previa */
            }
            await almacen.renombrar(ruta, prev);
        }
        await almacen.renombrar(tmp, ruta);
    };

    const encolarGuardado = () => {
        sucio = false;
        cadena = cadena.then(guardar).catch(aviso);
        return cadena;
    };

    return {
        /** Marca cambios: guarda tras un breve silencio, agrupando ráfagas de escrituras. */
        cambios() {
            sucio = true;
            if (temporizador) return;
            temporizador = setTimeout(() => {
                temporizador = null;
                if (sucio) encolarGuardado();
            }, retardo);
        },
        /** Guarda ya (al pasar a segundo plano o cerrar). */
        flush() {
            if (temporizador) {
                clearTimeout(temporizador);
                temporizador = null;
            }
            return sucio ? encolarGuardado() : cadena;
        },
        /** Abre el banco: el canónico si es válido; si está corrupto, la copia previa, que se
            restaura como canónico. `null` si no hay nada (primer arranque). */
        async abrir() {
            if (await valido(ruta)) return almacen.leer(ruta);
            if (await valido(prev)) {
                const bytes = await almacen.leer(prev);
                try {
                    await almacen.borrar(ruta);
                } catch {
                    /* el corrupto ya no estaba */
                }
                await almacen.renombrar(prev, ruta);
                return bytes;
            }
            return null;
        },
    };
}
