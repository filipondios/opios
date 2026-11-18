# Atajos para las operaciones repetitivas del proyecto.
# Uso: make <objetivo>  (make sin argumentos muestra esta lista con `make help`).

JAVA_HOME ?= $(HOME)/.local/lib/jvm/jdk-21
ANDROID_HOME ?= $(HOME)/Android/Sdk
ADB := $(ANDROID_HOME)/platform-tools/adb
EMULATOR := $(ANDROID_HOME)/emulator/emulator
AVD ?= Medium_Phone_API_37.0
PAQUETE ?= es.opios.app
# El .env local puede apuntar a un banco inexistente; en tests usamos el de ejemplo.
OPIOS_PREGUNTAS ?= ejemplo

export JAVA_HOME ANDROID_HOME
export PATH := $(JAVA_HOME)/bin:$(ANDROID_HOME)/platform-tools:$(ANDROID_HOME)/cmdline-tools/latest/bin:$(PATH)

BIOME := bunx @biomejs/biome@2.6.6
FUENTES := src test scripts server.js public/js

.PHONY: help deps test lint format format-check check bundle apk release install launch restart log db clear emulator devtools graph clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sed 's/:.*## / - /'

deps: ## Instalar dependencias (bun.lock no se versiona)
	bun install

test: ## Tests (OPIOS_PREGUNTAS=ejemplo por el .env local)
	OPIOS_PREGUNTAS=$(OPIOS_PREGUNTAS) bun test

lint: ## Linter (Igual que CI)
	$(BIOME) lint $(FUENTES)

format: ## Formatear en sitio
	$(BIOME) format --write $(FUENTES)

format-check: ## Comprobar formato sin escribir (igual que CI)
	$(BIOME) format $(FUENTES) package.json biome.json ejemplo

check: lint format-check test ## Todos los chequeos antes de publicar

bundle: ## Empaquetar el WebView (dist-web/)
	bun run empaquetar

apk: ## APK de debug (empaqueta, sync y assembleDebug)
	bun run android
	cd android && ./gradlew assembleDebug

release: ## APK firmado + .sha256 en dist/
	bun run release:android

install: ## Instalar el APK de debug en el dispositivo/emulador
	$(ADB) install -r android/app/build/outputs/apk/debug/app-debug.apk

launch: ## Arrancar la app en el dispositivo/emulador
	$(ADB) shell monkey -p $(PAQUETE) -c android.intent.category.LAUNCHER 1

restart: ## Forzar parada y arrancar la app
	$(ADB) shell am force-stop $(PAQUETE)
	$(MAKE) launch

log: ## Ver logcat del dispositivo/emulador
	$(ADB) logcat

db: ## Copiar el banco activo a banco-exportado.db (build de debug)
	$(ADB) exec-out run-as $(PAQUETE) cat files/banco/banco.db > banco-exportado.db

clear: ## Borrar datos de la app en el dispositivo/emulador
	$(ADB) shell pm clear $(PAQUETE)

emulator: ## Arrancar el AVD
	$(EMULATOR) -avd $(AVD) -no-audio

devtools: ## Abrir el puerto 9222 para chrome://inspect
	@PID=$$($(ADB) shell pidof $(PAQUETE)); echo "PID=$$PID"; \
	$(ADB) forward tcp:9222 localabstract:webview_devtools_remote_$$PID

graph: ## Actualizar el grafo de código
	graphify update .

clean: ## Limpiar artefactos de compilación (no toca dist/ ni el keystore)
	rm -rf dist-web android/app/build android/build
