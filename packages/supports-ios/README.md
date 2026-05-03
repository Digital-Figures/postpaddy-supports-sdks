# PostpaddySupports (iOS, Swift)

Thin REST client for the Postpaddy Supports backend. Same endpoints as the
React Native and Android SDKs.

## Install (Swift Package Manager)

In Xcode: *File → Add Packages…* and point at this folder, or add to your
`Package.swift`:

```swift
.package(path: "../packages/supports-ios"),
```

Add `"PostpaddySupports"` as a dependency of your target.

## Quick start

```swift
import PostpaddySupports

let client = SupportsClient(.init(
  widgetId: "wgt_xxx",
  supabaseURL: URL(string: "https://YOUR_PROJECT.supabase.co")!,
  supabaseAnonKey: "eyJ..."
))

try await client.identify(name: "Ada", email: "ada@example.com")
let conv = try await client.startConversation()
let history = try await client.loadHistory(visitorToken: conv.visitorToken)

// Send text
let msg = try await client.sendMessage(visitorToken: conv.visitorToken, text: "Hi!")

// Send a JPEG (always convert HEIC → JPEG first)
let jpeg = uiImage.jpegData(compressionQuality: 0.85)!
let att = SupportsClient.LocalAttachment(
  data: jpeg, mime: "image/jpeg", kind: "image",
  width: Int(uiImage.size.width), height: Int(uiImage.size.height)
)
_ = try await client.sendMessage(
  visitorToken: conv.visitorToken,
  text: "Check this out",
  attachments: [att]
)
```

## Realtime

This package intentionally has no realtime layer — pick one in your app:

- **Supabase Swift SDK** (`Realtime` module), subscribe to `postgres_changes`
  on `messages` filtered by `conversation_id=eq.<id>`.
- Or simple polling of `loadHistory()` every few seconds.

Endpoint contract: see `docs/postpaddy-mobile-spec.md`.
