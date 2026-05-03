// PostpaddySupports — Android/Kotlin client for the Supports backend.
// Same REST contract as the RN and iOS SDKs (see docs/postpaddy-mobile-spec.md).
package com.postpaddy.supports

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.UUID

data class SupportsConfig(
    val widgetId: String,
    val supabaseUrl: String,
    val supabaseAnonKey: String,
)

@Serializable data class WidgetConfig(
    val brand_id: String,
    val brand_name: String,
    val brand_color: String? = null,
    val assistant_name: String? = null,
)

@Serializable data class Attachment(
    val url: String,
    val mime: String,
    val kind: String,
    val width: Int? = null,
    val height: Int? = null,
    val duration_ms: Int? = null,
)

@Serializable data class Message(
    val id: String,
    val conversation_id: String,
    val sender: String,
    val sender_name: String? = null,
    val content: String? = null,
    val translated_content: String? = null,
    val attachment_url: String? = null,
    val created_at: String,
)

data class StartResult(
    val visitorToken: String,
    val conversationId: String,
    val visitorLanguage: String?,
)

class SupportsException(val status: Int, message: String) : RuntimeException(message)

class SupportsClient(
    context: Context,
    private val cfg: SupportsConfig,
    private val http: OkHttpClient = OkHttpClient(),
) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("postpaddy.supports", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    private val TOKEN_KEY = "contact_token"
    private val VUID_KEY = "visitor_uid"
    private val JSON_MT = "application/json".toMediaType()

    suspend fun bootstrap(): WidgetConfig =
        post("widget-bootstrap", buildJsonObject { put("widget_id", cfg.widgetId) })
            .let { json.decodeFromJsonElement(WidgetConfig.serializer(), it) }

    suspend fun identify(
        name: String? = null, email: String? = null,
        phone: String? = null, externalUserId: String? = null,
    ) {
        val body = buildJsonObject {
            put("widget_id", cfg.widgetId)
            put("visitor_uid", visitorUid())
            name?.let { put("name", it) }
            email?.let { put("email", it) }
            phone?.let { put("phone", it) }
            externalUserId?.let { put("external_user_id", it) }
        }
        val r = post("widget-start", body)
        (r.jsonObject["contact_token"] as? JsonPrimitive)?.contentOrNull?.let {
            prefs.edit().putString(TOKEN_KEY, it).apply()
        }
    }

    suspend fun startConversation(): StartResult {
        val body = buildJsonObject {
            put("widget_id", cfg.widgetId)
            put("visitor_uid", visitorUid())
            prefs.getString(TOKEN_KEY, null)?.let { put("contact_token", it) }
        }
        val r = post("widget-start", body).jsonObject
        (r["contact_token"] as? JsonPrimitive)?.contentOrNull?.let {
            prefs.edit().putString(TOKEN_KEY, it).apply()
        }
        return StartResult(
            visitorToken = r.getValue("visitor_token").jsonPrimitive.content,
            conversationId = r.getValue("conversation_id").jsonPrimitive.content,
            visitorLanguage = (r["visitor_language"] as? JsonPrimitive)?.contentOrNull,
        )
    }

    suspend fun openConversation(conversationId: String): StartResult {
        val tok = prefs.getString(TOKEN_KEY, null)
            ?: throw IllegalStateException("Call identify() first")
        val r = post("widget-open-conversation", buildJsonObject {
            put("widget_id", cfg.widgetId); put("contact_token", tok); put("conversation_id", conversationId)
        }).jsonObject
        return StartResult(
            visitorToken = r.getValue("visitor_token").jsonPrimitive.content,
            conversationId = r.getValue("conversation_id").jsonPrimitive.content,
            visitorLanguage = (r["visitor_language"] as? JsonPrimitive)?.contentOrNull,
        )
    }

    suspend fun loadHistory(visitorToken: String): List<Message> {
        val r = post("widget-history", buildJsonObject { },
            extraHeaders = mapOf("x-visitor-token" to visitorToken)).jsonObject
        val arr = r["messages"]?.jsonArray ?: return emptyList()
        return arr.map { json.decodeFromJsonElement(Message.serializer(), it) }
    }

    /** LocalAttachment carries the bytes you want to upload. */
    data class LocalAttachment(
        val bytes: ByteArray,
        val mime: String,
        val kind: String,                 // "image" | "video"
        val width: Int? = null,
        val height: Int? = null,
        val durationMs: Int? = null,
    )

    suspend fun sendMessage(
        visitorToken: String,
        text: String,
        attachments: List<LocalAttachment> = emptyList(),
    ): Message {
        val uploaded = attachments.map { uploadAttachment(visitorToken, it) }
        val body = buildJsonObject {
            put("message", text)
            put("attachments", buildJsonArray {
                uploaded.forEach { add(json.encodeToJsonElement(Attachment.serializer(), it)) }
            })
        }
        val r = post("widget-send-message", body,
            extraHeaders = mapOf("x-visitor-token" to visitorToken)).jsonObject
        return json.decodeFromJsonElement(Message.serializer(), r.getValue("message"))
    }

    suspend fun setLanguage(visitorToken: String, language: String) {
        post("widget-set-language", buildJsonObject { put("language", language) },
            extraHeaders = mapOf("x-visitor-token" to visitorToken))
    }

    fun reset() {
        prefs.edit().remove(TOKEN_KEY).remove(VUID_KEY).apply()
    }

    // ---------- internals ----------

    private fun visitorUid(): String {
        prefs.getString(VUID_KEY, null)?.let { return it }
        val v = "vuid_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}"
        prefs.edit().putString(VUID_KEY, v).apply()
        return v
    }

    private suspend fun uploadAttachment(visitorToken: String, a: LocalAttachment): Attachment {
        val signed = post("chat-upload-sign", buildJsonObject {
            put("kind", a.kind); put("mime_type", a.mime); put("size_bytes", a.bytes.size)
        }, extraHeaders = mapOf("x-visitor-token" to visitorToken)).jsonObject
        val uploadUrl = signed.getValue("upload_url").jsonPrimitive.content
        val publicUrl = signed.getValue("public_url").jsonPrimitive.content

        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url(uploadUrl)
                .put(a.bytes.toRequestBody(a.mime.toMediaType()))
                .build()
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) throw SupportsException(res.code, "GCS upload failed")
            }
        }
        return Attachment(publicUrl, a.mime, a.kind, a.width, a.height, a.durationMs)
    }

    private suspend fun post(
        path: String,
        body: JsonElement,
        extraHeaders: Map<String, String> = emptyMap(),
    ): JsonElement = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("${cfg.supabaseUrl.trimEnd('/')}/functions/v1/$path")
            .post(body.toString().toRequestBody(JSON_MT))
            .header("apikey", cfg.supabaseAnonKey)
            .header("Authorization", "Bearer ${cfg.supabaseAnonKey}")
            .apply { extraHeaders.forEach { (k, v) -> header(k, v) } }
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw SupportsException(res.code, text)
            if (text.isBlank()) JsonObject(emptyMap()) else json.parseToJsonElement(text)
        }
    }
}
