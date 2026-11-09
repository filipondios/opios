import { join } from "node:path";
import { desdeJsonAntiguo, validarInfoBloque, opcionDependiente } from "./validar.js";
import { RE_TEMA, recorrerBanco } from "./estructura-banco.js";

const numeroDeTema = (nombre) => Number(RE_TEMA.exec(nombre)?.[1]);

/** Lee un archivo que debe contener una lista de preguntas (o { preguntas: [...] }). */
async function leerLista(archivo) {
    let datos;
    try {
        datos = await Bun.file(archivo).json();
    } catch (e) {
        throw new Error(`JSON no válido (${e.message})`);
    }
    if (!Array.isArray(datos)) datos = datos && Array.isArray(datos.preguntas) ? datos.preguntas : null;
    if (!datos) throw new Error("debe contener una lista de preguntas");
    return datos;
}

/** Convierte una pregunta de un `tema_N.json` de bloque al formato interno, comprobando metadatos. */
function desdeJsonDeBloque(p, { bloqueNumero, bloqueNombre, temaNumero, archivo }) {
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("no es un objeto");
    if (p.bloque != null && String(p.bloque).trim() !== "") {
        const declarado = String(p.bloque).trim();
        const coincide = /^\d+$/.test(declarado)
            ? Number(declarado) === bloqueNumero
            : declarado.toLowerCase() === bloqueNombre.toLowerCase();
        if (!coincide) throw new Error(`el bloque declarado («${declarado}») no coincide con ${archivo}`);
    }
    const temaDeclarado = p.tema_numero ?? p.tema;
    if (temaDeclarado != null && String(temaDeclarado).trim() !== "" && Number(temaDeclarado) !== temaNumero)
        throw new Error(`el tema declarado (${temaDeclarado}) no coincide con ${archivo}`);
    return desdeJsonAntiguo({
        ...p,
        /* `desdeJsonAntiguo` lee el tema de `tema_numero`; se pasa también en `tema` por si el
           JSON solo trae ese campo. El número del archivo manda sobre lo declarado. */
        tema: temaNumero,
        tema_numero: temaNumero,
        bloque: bloqueNombre,
        bloque_numero: bloqueNumero,
    });
}

/**
 * Importa un banco con la estructura `bloque_N/info.json` + `bloque_N/tema_N.json`.
 * El recorrido lo hace `src/estructura-banco.js`: cualquier otro archivo o carpeta se ignora.
 * `formatoAntiguo` trae los JSON sueltos de la raíz, que siguen funcionando por transición.
 */
async function importarPorBloques(repo, dir, opciones) {
    const banco = await recorrerBanco(dir, { soloBloques: true });
    const validas = [],
        errores = [],
        avisos = [],
        gestionados = [];
    let archivos = 0;

    if (!banco)
        return {
            archivos: 0,
            nuevas: 0,
            duplicadas: 0,
            actualizadas: 0,
            errores: [`No existe el directorio ${dir}`],
            avisos: [],
        };
    avisos.push(...banco.avisos);

    for (const bloque of banco.bloques) {
        const { nombre: carpeta, numero: bloqueNumero, ruta, info: archivoInfo } = bloque;
        let info = null;
        if (archivoInfo) {
            try {
                const datos = await Bun.file(archivoInfo.ruta).json();
                if (datos?.numero != null && Number(datos.numero) !== bloqueNumero)
                    throw new Error(`el número declarado (${datos.numero}) no coincide con la carpeta ${carpeta}`);
                info = validarInfoBloque(datos);
            } catch (e) {
                errores.push(`${carpeta}/info.json: ${e.message}`);
            }
        }

        const bloqueNombre = info?.nombre ?? `Bloque ${bloqueNumero}`;
        if (info) {
            try {
                repo.sincronizarInfoBloque(bloqueNumero, info);
                gestionados.push(bloqueNumero);
            } catch (e) {
                errores.push(`${carpeta}/info.json: ${e.message}`);
            }
        } else {
            try {
                repo.asegurarBloque({ numero: bloqueNumero, nombre: bloqueNombre });
            } catch (e) {
                errores.push(`${carpeta}: ${e.message}`);
            }
        }

        if (info) {
            const declarados = new Set(info.temas.map((t) => t.numero));
            for (const t of bloque.temas)
                if (!declarados.has(t.numero))
                    avisos.push(
                        `${carpeta}/${t.nombre}: el tema ${t.numero} no aparece en info.json (se importa igual).`,
                    );
        }

        for (const tema of bloque.temas) {
            archivos++;
            let datos;
            try {
                datos = await leerLista(tema.ruta);
            } catch (e) {
                errores.push(`${carpeta}/${tema.nombre}: ${e.message}`);
                continue;
            }
            datos.forEach((p, i) => {
                try {
                    const v = desdeJsonDeBloque(p, {
                        bloqueNumero,
                        bloqueNombre,
                        temaNumero: numeroDeTema(tema.nombre),
                        archivo: `${carpeta}/${tema.nombre} #${i + 1}`,
                    });
                    const dep = opcionDependiente(v.respuestas);
                    if (dep)
                        avisos.push(
                            `${carpeta}/${tema.nombre} #${i + 1}: la opción «${dep}» parece depender del orden de las opciones.`,
                        );
                    validas.push(v);
                } catch (e) {
                    errores.push(`${carpeta}/${tema.nombre} #${i + 1}: ${e.message}`);
                }
            });
        }
    }

    repo.desmarcarGestionadosExcepto(gestionados);

    /* Transición: los JSON sueltos de la raíz siguen funcionando, con aviso. */
    for (const ruta of banco.sueltos) {
        const nombre = ruta.slice(dir.length + 1);
        if (/^info\.json$/i.test(nombre)) continue;
        archivos++;
        let datos;
        try {
            datos = await leerLista(ruta);
        } catch (e) {
            errores.push(`${nombre}: ${e.message}`);
            continue;
        }
        datos.forEach((p, i) => {
            try {
                const v = desdeJsonAntiguo(p);
                const dep = opcionDependiente(v.respuestas);
                if (dep)
                    avisos.push(`${nombre} #${i + 1}: la opción «${dep}» parece depender del orden de las opciones.`);
                validas.push(v);
            } catch (e) {
                errores.push(`${nombre} #${i + 1}: ${e.message}`);
            }
        });
    }
    if (banco.sueltos.length)
        avisos.push(
            "Hay JSON sueltos en la raíz del banco: usa bloque_X/tema_N.json (el formato antiguo sigue funcionando por ahora).",
        );

    const { nuevas, duplicadas, actualizadas } = repo.importar(validas, opciones);
    return { archivos, nuevas, duplicadas, actualizadas, errores, avisos };
}

/** Importa un directorio: detecta `bloque_N/` o cae al formato antiguo de JSON sueltos. */
export async function importarDirectorio(repo, dir, opciones = {}) {
    const banco = await recorrerBanco(dir);
    if (!banco)
        return {
            archivos: 0,
            nuevas: 0,
            duplicadas: 0,
            actualizadas: 0,
            errores: [`No existe el directorio ${dir}`],
            avisos: [],
        };

    if (banco.bloques.length) return importarPorBloques(repo, dir, opciones);

    /* Formato antiguo: solo JSON sueltos en la raíz, sin avisos (aquí es el formato normal). */
    const validas = [],
        errores = [];
    let archivos = 0;
    for (const ruta of banco.sueltos) {
        const nombre = ruta.slice(dir.length + 1);
        if (/^info\.json$/i.test(nombre)) continue;
        archivos++;
        let datos;
        try {
            datos = await leerLista(ruta);
        } catch (e) {
            errores.push(`${nombre}: ${e.message}`);
            continue;
        }
        datos.forEach((p, i) => {
            try {
                validas.push(desdeJsonAntiguo(p));
            } catch (e) {
                errores.push(`${nombre} #${i + 1}: ${e.message}`);
            }
        });
    }
    const { nuevas, duplicadas, actualizadas } = repo.importar(validas, opciones);
    return {
        archivos,
        nuevas,
        duplicadas,
        actualizadas,
        errores,
        avisos: banco.avisos,
    };
}
