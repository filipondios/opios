package es.opios.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.StatFs
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/*
 * Selector de documentos (F4.3): elige un archivo para importar (ACTION_OPEN_DOCUMENT) o un
 * destino para exportar (ACTION_CREATE_DOCUMENT) con el selector del sistema (SAF).
 *
 * Ventajas frente a un <input type=file>: el usuario decide qué archivo se comparte y la app
 * NO pide permisos de almacenamiento (solo lee lo que se elija). El archivo elegido se copia a
 * la caché privada y JS recibe el nombre de esa copia: el original no se toca y el acceso no es
 * permanente (R4). El plugin no guarda ninguna URI: al terminar, el temporal se borra.
 */
@CapacitorPlugin(name = "SelectorDocumentos")
class SelectorDocumentos : Plugin() {

    /* Tipos que acepta el asistente de importación (F3.4). Se incluyen las variantes que
       usan los gestores de archivos reales (un .db o .json puede llegar como texto u
       octet-stream); la validación real es por contenido en `detectarArchivo`. */
    private val tiposImportables = arrayOf(
        "application/x-opios",
        "application/vnd.sqlite3",
        "application/x-sqlite3",
        "application/json",
        "text/plain",
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream",
    )

    /** Abre el selector del sistema y copia el archivo elegido a la caché privada. */
    @PluginMethod
    fun abrir(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, tiposImportables)
        }
        startActivityForResult(call, intent, "alElegir")
    }

    /** Pide un destino para exportar (lo usará exportar/compartir, F5.8). */
    @PluginMethod
    fun crear(call: PluginCall) {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = call.getString("mime") ?: "application/x-opios"
            putExtra(Intent.EXTRA_TITLE, call.getString("nombre") ?: "banco.opios")
        }
        startActivityForResult(call, intent, "alCrear")
    }

    /*
     * Escribe en el destino elegido con crear() el archivo .opios exportado (F5.8).
     * JS pasa los bytes en base64: el WebView no tiene acceso directo al content:// del SAF,
     * pero la app sí, a través del permiso que da el propio selector al elegir destino.
     */
    @PluginMethod
    fun guardar(call: PluginCall) {
        val uri = call.getString("uri")?.let { Uri.parse(it) }
        val datos = call.getString("datos")
        if (uri == null || datos == null) {
            call.reject("Faltan los datos para guardar el archivo.")
            return
        }
        try {
            val bytes = android.util.Base64.decode(datos, android.util.Base64.DEFAULT)
            context.contentResolver.openOutputStream(uri)?.use { salida -> salida.write(bytes) }
                ?: run {
                    call.reject("No se pudo escribir en el destino elegido.")
                    return
                }
            call.resolve()
        } catch (e: Exception) {
            call.reject("No se pudo guardar el archivo: ${e.message}")
        }
    }

    /** Espacio libre del almacenamiento interno, en bytes (F4.4: avisar antes de importar). */
    @PluginMethod
    fun espacioLibre(call: PluginCall) {
        val libre = StatFs(context.filesDir.absolutePath).availableBytes
        call.resolve(JSObject().put("bytes", libre))
    }

    /* Capacitor llama a estas funciones cuando el usuario vuelve del selector; el nombre
       coincide con el tercer argumento de startActivityForResult. */

    @ActivityCallback
    private fun alElegir(call: PluginCall?, resultado: ActivityResult) {
        if (call == null) return
        val uri = resultado.data?.data
        if (resultado.resultCode != Activity.RESULT_OK || uri == null) {
            /* Cancelar no es un error: JS lo trata como "sin archivo". */
            call.resolve(JSObject().put("cancelado", true))
            return
        }
        copiarACache(call, uri)
    }

    @ActivityCallback
    private fun alCrear(call: PluginCall?, resultado: ActivityResult) {
        if (call == null) return
        val uri = resultado.data?.data
        if (resultado.resultCode != Activity.RESULT_OK || uri == null) {
            call.resolve(JSObject().put("cancelado", true))
            return
        }
        call.resolve(JSObject().put("uri", uri.toString()))
    }

    /* Copia el documento (content://...) a un temporal de la caché de la app. */
    private fun copiarACache(call: PluginCall, uri: Uri) {
        val destino = File(context.cacheDir, "importado-${System.currentTimeMillis()}.tmp")
        try {
            val tamano = tamanoDe(uri)
            /* Hacen falta el archivo en caché y luego su copia en los datos de la app: se
               exige el doble del tamaño más 1 MB de margen (F4.4). */
            val libre = StatFs(context.filesDir.absolutePath).availableBytes
            if (tamano > 0 && libre < tamano * 2 + 1_000_000) {
                call.reject("No hay espacio libre suficiente para importar este banco (${tamano / 1_000_000} MB).")
                return
            }
            context.contentResolver.openInputStream(uri)?.use { entrada ->
                destino.outputStream().use { salida -> entrada.copyTo(salida) }
            } ?: run {
                call.reject("No se pudo leer el archivo elegido.")
                return
            }
            call.resolve(
                JSObject()
                    .put("ruta", destino.name)
                    .put("nombre", nombreDe(uri) ?: destino.name)
                    .put("bytes", destino.length()),
            )
        } catch (e: Exception) {
            destino.delete() // no dejar temporales si la copia falla
            call.reject("No se pudo copiar el archivo: ${e.message}")
        }
    }

    /* Nombre visible del documento ("mi banco.opios"). */
    private fun nombreDe(uri: Uri): String? =
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }

    /* Tamaño en bytes del documento (-1 si el proveedor no lo dice). */
    private fun tamanoDe(uri: Uri): Long =
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
            ?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L } ?: -1L
}
