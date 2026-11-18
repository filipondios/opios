/* Identificador estable del banco activo (F1.5). Se guarda una sola vez en `ajustes` y
   permite que el cliente prefije con él las claves de localStorage dependientes del banco. */
export function idBanco(repo) {
    const guardado = repo.ajustes().uuid_banco;
    if (guardado) return guardado;
    const id = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    repo.guardarAjuste("uuid_banco", id);
    return id;
}
