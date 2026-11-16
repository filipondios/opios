/* Firma, versionado y script de release (7.1–7.3): comprobaciones de configuración. El APK
   real solo se compila con JDK/SDK, así que aquí se verifica el cableado, no el build. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dir, "..");
const leer = (ruta) => readFileSync(join(RAIZ, ruta), "utf8");

describe("release de Android (7.1–7.3)", () => {
    test("el keystore y sus claves no se versionan", () => {
        const ignore = leer(".gitignore");
        expect(ignore).toMatch(/android\/keystore\.properties/);
        expect(ignore).toMatch(/android\/\*\.jks/);
        const ejemplo = leer("android/keystore.properties.example");
        for (const clave of ["storeFile", "storePassword", "keyAlias", "keyPassword"])
            expect(ejemplo).toMatch(new RegExp(`^${clave}=`, "m"));
    });

    test("el build toma la versión de package.json y firma el release", () => {
        const gradle = leer("android/app/build.gradle");
        expect(gradle).toContain('new groovy.json.JsonSlurper().parse(file("${rootDir}/../package.json")).version');
        expect(gradle).toMatch(/versionCode versionCodeApp/);
        expect(gradle).toMatch(/versionName versionApp/);
        expect(gradle).toMatch(/signingConfigs\s*\{/);
        expect(gradle).toMatch(/signingConfig signingConfigs\.release/);
        expect(gradle).toContain("minifyEnabled false");
    });

    test("release:android empaqueta, sincroniza, compila y genera sha256", () => {
        const pkg = JSON.parse(leer("package.json"));
        expect(pkg.scripts["release:android"]).toContain("release-android.js");
        const script = leer("scripts/release-android.js");
        for (const paso of ["empaquetar", "cap", "sync", "android", "assembleRelease", "sha256"])
            expect(script).toContain(paso);
        expect(script).toContain("keystore.properties");
        expect(leer("CHANGELOG.md")).toContain("## v");
    });

    test("el workflow publica el APK del tag y CI comprueba el bundle", () => {
        const release = leer(".github/workflows/release.yml");
        expect(release).toMatch(/tags:\s*\n\s*- 'v\*'/);
        expect(release).toContain("KEYSTORE_BASE64");
        expect(release).toContain("bun run release:android");
        expect(release).toContain("gh release create");
        expect(leer(".github/workflows/test.yml")).toContain("test/contratos-no-bun.test.js");
    });

    test("el aviso de versión y el instalador están cableados", () => {
        const aviso = leer("public/js/actualizaciones.js");
        expect(aviso).toContain("releases/latest");
        expect(aviso).toContain("getInfo()");
        expect(aviso).toContain("CLAVE_DIA");
        expect(aviso).toContain("orígenes desconocidos");
        expect(leer("src/views/layout.js")).toContain("/js/actualizaciones.js");

        const plugin = leer("android/app/src/main/java/es/opios/app/InstaladorApk.kt");
        expect(plugin).toContain('CapacitorPlugin(name = "InstaladorApk")');
        expect(plugin).toContain('MessageDigest.getInstance("SHA-256")');
        expect(plugin).toContain("application/vnd.android.package-archive");
        expect(leer("android/app/src/main/AndroidManifest.xml")).toContain("REQUEST_INSTALL_PACKAGES");
        expect(leer("android/app/src/main/java/es/opios/app/MainActivity.kt")).toContain(
            "registerPlugin(InstaladorApk::class.java)",
        );
    });
});
