package es.opios.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity

/*
 * Actividad principal de la app.
 *
 * `BridgeActivity` (de Capacitor) monta el WebView y carga el shell empaquetado en
 * `assets/public` (dist-web). Los plugins nativos propios (D7) se registran aquí ANTES de
 * `super.onCreate`: es lo que crea el puente de Capacitor.
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(SelectorDocumentos::class.java)
        registerPlugin(InstaladorApk::class.java)
        super.onCreate(savedInstanceState)
    }
}
