package es.opios.app

import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.net.URL
import java.security.MessageDigest

/*
 * Instalador de actualizaciones (7.6): descarga el APK de la release, comprueba su huella
 * SHA-256 y abre el instalador del sistema. El FileProvider ya está declarado en el manifest
 * y en file_paths.xml (la caché de la app está compartida ahí). El usuario debe aceptar el
 * permiso de «orígenes desconocidos» la primera vez: se le explica en el aviso de la UI.
 */
@CapacitorPlugin(name = "InstaladorApk")
class InstaladorApk : Plugin() {

    /** Descarga el APK a la caché privada solo si su sha256 coincide con el publicado. */
    @PluginMethod
    fun descargar(call: PluginCall) {
        val url = call.getString("url")
        val esperada = call.getString("sha256")?.lowercase()
        if (url == null || esperada == null) {
            call.reject("Faltan la URL o la huella del APK.")
            return
        }
        /* Hilo aparte para no bloquear el WebView mientras se descarga. */
        Thread {
            try {
                val destino = File(context.cacheDir, "actualizacion.apk")
                URL(url).openStream().use { entrada ->
                    destino.outputStream().use { salida -> entrada.copyTo(salida) }
                }
                val real = MessageDigest.getInstance("SHA-256")
                    .digest(destino.readBytes())
                    .joinToString("") { "%02x".format(it) }
                if (real != esperada) {
                    destino.delete()
                    call.reject("La huella del APK no coincide: no se instaló.")
                } else {
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", destino)
                    call.resolve(JSObject().put("uri", uri.toString()))
                }
            } catch (e: Exception) {
                call.reject("No se pudo descargar el APK: ${e.message}")
            }
        }.start()
    }

    /** Pasa el APK al instalador del sistema con permiso de lectura temporal. */
    @PluginMethod
    fun instalar(call: PluginCall) {
        val uri = call.getString("uri")?.let { Uri.parse(it) }
        if (uri == null) {
            call.reject("Falta el APK descargado.")
            return
        }
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("No se pudo abrir el instalador: ${e.message}")
        }
    }
}
