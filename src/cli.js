/** Ejecuta el cuerpo de un CLI y convierte cualquier excepción en un mensaje corto. */
export async function ejecutarCli(fn) {
    try {
        return await fn();
    } catch (e) {
        console.error(`error: ${e?.message ?? e}`);
        process.exit(1);
    }
}
