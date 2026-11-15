/* Almacén en memoria para tests (F2.1). `archivos` es un Map ruta -> Uint8Array, expuesto
   para poder preparar estados y comprobar el resultado. */
export function crearAlmacenMemoria(inicial = {}) {
    const archivos = new Map(Object.entries(inicial));
    const hijos = (dir) => {
        const prefijo = dir === "." || dir === "" ? "" : dir.replace(/\/$/, "") + "/";
        const nombres = new Set();
        for (const ruta of archivos.keys())
            if (ruta.startsWith(prefijo) && ruta !== prefijo.slice(0, -1))
                nombres.add(ruta.slice(prefijo.length).split("/")[0]);
        return [...nombres];
    };
    return {
        archivos,
        existe: async (ruta) => archivos.has(ruta),
        leer: async (ruta) => {
            const bytes = archivos.get(ruta);
            if (bytes === undefined) throw new Error(`No existe ${ruta}.`);
            return bytes;
        },
        escribir: async (ruta, bytes) => {
            archivos.set(ruta, bytes);
        },
        renombrar: async (de, a) => {
            archivos.set(a, archivos.get(de));
            archivos.delete(de);
        },
        borrar: async (ruta) => {
            archivos.delete(ruta);
        },
        listar: async (dir) => hijos(dir),
    };
}
