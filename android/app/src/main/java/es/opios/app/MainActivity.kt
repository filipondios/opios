package es.opios.app

import com.getcapacitor.BridgeActivity

/*
 * Actividad principal de la app.
 *
 * `BridgeActivity` (de Capacitor) es quien monta el WebView y carga el shell empaquetado en
 * `assets/public` (dist-web). Todavía no hay código nativo propio: los plugins nuestros
 * (selector de documentos, instalación de APK) se registrarán aquí con `registerPlugin()`.
 */
class MainActivity : BridgeActivity()
