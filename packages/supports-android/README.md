# PostpaddySupports (Android, Kotlin)

Thin Kotlin client for the Postpaddy Supports backend. Same endpoints as the
React Native and iOS SDKs.

## Install

Either include this folder as a Gradle module:

```kotlin
// settings.gradle.kts
include(":supports-android")
project(":supports-android").projectDir = file("../packages/supports-android")
```

```kotlin
// app/build.gradle.kts
dependencies { implementation(project(":supports-android")) }
```

Or publish it to your internal Maven later — the public API doesn't change.

## Quick start

```kotlin
val client = SupportsClient(
  context = applicationContext,
  cfg = SupportsConfig(
    widgetId = "wgt_xxx",
    supabaseUrl = "https://YOUR_PROJECT.supabase.co",
    supabaseAnonKey = "eyJ...",
  )
)

lifecycleScope.launch {
  client.identify(name = "Ada", email = "ada@example.com")
  val conv = client.startConversation()
  val history = client.loadHistory(conv.visitorToken)

  // Send text
  client.sendMessage(conv.visitorToken, "Hi!")

  // Send a JPEG (Android encoders give you JPEG/PNG natively — HEIC is not
  // an issue here, but other clients on the conversation may not render it.)
  val bytes = bitmap.toJpeg(quality = 85)
  client.sendMessage(
    conv.visitorToken, "Check this out",
    attachments = listOf(
      SupportsClient.LocalAttachment(bytes, "image/jpeg", "image",
        width = bitmap.width, height = bitmap.height)
    )
  )
}
```

## Realtime

Not bundled. Use the Supabase Kotlin SDK and subscribe to `postgres_changes`
on the `messages` table filtered by `conversation_id=eq.<id>`, or poll
`loadHistory()`.

Endpoint contract: see `docs/postpaddy-mobile-spec.md`.
