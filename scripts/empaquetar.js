/* bun run empaquetar (task 11): prepara dist-web/ para Capacitor (webDir).
   - copia public/ y sustituye cliente.js por el cliente local (mismo contrato),
   - empaqueta el núcleo (puente + adaptador SQLite WASM + API + páginas) con Bun.build,
   - copia el binario WASM de sql.js y genera el index.html del shell.
   Después: bunx cap sync android. */
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { ejecutarCli } from "../src/cli.js";

const INDEX = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opios</title>
<link rel="stylesheet" href="/css/base.css">
<link rel="icon" href="/logo.png">
</head>
<body>
<script type="module" src="/opios.js"></script>
</body>
</html>
`;

await ejecutarCli(async () => {
    rmSync("dist-web", { recursive: true, force: true });
    mkdirSync("dist-web", { recursive: true });
    cpSync("public", "dist-web", { recursive: true });
    copyFileSync("public/js/cliente-local.js", "dist-web/js/cliente.js");

    const r = await Bun.build({
        entrypoints: ["src/android/shell.js"],
        outdir: "dist-web",
        naming: "opios.js",
        target: "browser",
        format: "esm",
    });
    if (!r.success) {
        for (const l of r.logs) console.error(l);
        process.exit(1);
    }
    copyFileSync("node_modules/sql.js/dist/sql-wasm.wasm", "dist-web/sql-wasm.wasm");
    writeFileSync("dist-web/index.html", INDEX);
    console.log("dist-web listo. Siguiente paso: bunx cap sync android");
});
