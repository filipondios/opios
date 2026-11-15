/* Versión PC de la importación (F2.6): un directorio real como `fuente`. El núcleo neutro
   (importarFuente, para Android/zip también) vive en seed.js. */
import { importarFuente } from "./seed.js";
import { fuenteDirectorio } from "./fuente-directorio.js";

export async function importarDirectorio(repo, dir, opciones = {}) {
    return importarFuente(repo, fuenteDirectorio(dir), opciones);
}
