/* APK de release (7.3): empaqueta la web, sincroniza Capacitor, compila el APK firmado y
   deja en dist/ el archivo con su sha256. Requiere JDK 21, SDK de API 36 y el keystore
   configurado en android/keystore.properties (ver android/keystore.properties.example). */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ejecutarCli } from "../src/cli.js";

await ejecutarCli(async () => {
    const raiz = join(import.meta.dir, "..");
    const propiedades = join(raiz, "android", "keystore.properties");
    if (!existsSync(propiedades))
        throw new Error("Falta android/keystore.properties: copia keystore.properties.example y genera tu keystore.");
    const texto = readFileSync(propiedades, "utf8");
    const valor = (clave) => texto.match(new RegExp(`^${clave}=(.*)$`, "m"))?.[1]?.trim();
    const almacen = valor("storeFile");
    if (!almacen || !existsSync(join(raiz, "android", almacen)))
        throw new Error("El keystore de keystore.properties no existe; genera la clave antes de publicar.");

    const version = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).version;
    const ejecutar = async (cmd, args, cwd) => {
        const proc = Bun.spawn({ cmd: [cmd, ...args], cwd, stdout: "inherit", stderr: "inherit" });
        const codigo = await proc.exited;
        if (codigo !== 0) throw new Error(`${cmd} ${args.join(" ")} falló (código ${codigo}).`);
    };

    await ejecutar("bun", ["run", "empaquetar"], raiz);
    await ejecutar("bun", ["x", "cap", "sync", "android"], raiz);
    await ejecutar(join(raiz, "android", "gradlew"), ["assembleRelease"], join(raiz, "android"));

    const apk = join(raiz, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
    if (!existsSync(apk)) throw new Error("No se encontró el APK de release; revisa la salida de gradlew.");
    const destino = join(raiz, "dist", `opios-${version}.apk`);
    mkdirSync(join(raiz, "dist"), { recursive: true });
    copyFileSync(apk, destino);
    const sha256 = createHash("sha256").update(readFileSync(destino)).digest("hex");
    writeFileSync(`${destino}.sha256`, `${sha256}  opios-${version}.apk\n`);
    console.log(`APK: ${destino}\nsha256: ${sha256}`);
});
