/* Fuente de archivos de un banco JSON (F2.6): la única puerta para listar y leer los
   archivos de un banco. Neutra de plataforma: las rutas son relativas a la raíz de la
   fuente, nunca del sistema de archivos. Contrato: `listar(dir) -> nombres de primer
   nivel` y `leerTexto(ruta) -> string` (lanza si no existe). Implementaciones:
   `fuenteMemoria` (aquí: RAM, Android/zip y tests) y `fuenteDirectorio` en
   `fuente-directorio.js` (node:fs, PC/CLI). El zip de Android entrará en F4 como otra
   fuente con los mismos dos métodos. */
export const METODOS_FUENTE = ["listar", "leerTexto"];

/** Lanza si `fuente` no implementa el contrato completo (lo usan los tests). */
export function comprobarFuente(fuente) {
    for (const m of METODOS_FUENTE)
        if (typeof fuente?.[m] !== "function") throw new Error(`La fuente no implementa ${m}().`);
    return fuente;
}

/** Fuente en memoria: Map ruta -> texto. `listar` devuelve los nombres de primer nivel de
    cada carpeta, igual que un directorio real ("bloque_1/tema_1.json" está en "bloque_1"). */
export function fuenteMemoria(inicial = {}) {
    const archivos = new Map(Object.entries(inicial));
    const hijos = (dir) => {
        const prefijo = dir ? dir.replace(/\/$/, "") + "/" : "";
        return [
            ...new Set(
                [...archivos.keys()]
                    .filter((r) => r.startsWith(prefijo) && r !== prefijo.slice(0, -1))
                    .map((r) => r.slice(prefijo.length).split("/")[0]),
            ),
        ];
    };
    return {
        archivos,
        listar: async (dir = "") => hijos(dir),
        leerTexto: async (ruta) => {
            const texto = archivos.get(ruta);
            if (texto === undefined) throw new Error(`No existe ${ruta} en la fuente.`);
            return texto;
        },
    };
}
