# @postpaddy/supports-react-native

The official **Postpaddy Supports** React Native SDK — drop-in customer chat
(AI assistant + human handoff + tickets) for any RN / Expo app. Same backend
the Postpaddy web widget and dashboard talk to, so messages your users send
from the mobile app show up in your **Inbox** and **Tickets** dashboard
alongside web chats in real time.

---

## Install

```sh
npm i @postpaddy/supports-react-native
```

That's it. AsyncStorage is bundled. Two **optional** extras unlock the
realtime + picker features:

```sh
# Realtime live updates (recommended — without it, messages only appear after refresh)
npm i @supabase/supabase-js

# Built-in image / video / camera helpers
npx expo install expo-image-picker
```

Two more optional Expo packages enable the new-message notification polish:

```sh
# Soft notification tone when a support reply arrives
npx expo install expo-av

# Light haptic tap on supported devices
npx expo install expo-haptics
```

If either package is missing, the SDK still works and simply skips that effect.

You don't need an API key. The SDK ships with the Postpaddy backend URL baked
in. The only thing you provide is your **widget id** (find it in your
Postpaddy dashboard → **Messenger → Install**, the same id the web widget uses).

---

## Quick start (the whole messenger)

```tsx
import {
  SupportsProvider,
  SupportsMessenger,
  pickImage,
} from "@postpaddy/supports-react-native";

export default function SupportScreen() {
  return (
    <SupportsProvider options={{ widgetId: "wgt_xxx", defaultLanguage: "en" }}>
      <SupportsMessenger
        // Optional: pre-fill the visitor identity. Same fields the web widget
        // accepts — all optional.
        identity={{ name: "Ada Lovelace", email: "ada@example.com", external_user_id: "user_42" }}
        // Optional: enable image/video attachments using the bundled picker.
        onPickAttachment={() => pickImage({ multiple: true })}
        // Optional: called when the visitor taps the × in the header.
        onClose={() => navigation.goBack()}
      />
    </SupportsProvider>
  );
}
```

That's the full integration. `<SupportsMessenger />` mirrors the web widget
1:1:

- **Conversations list** for returning visitors (with a "Start a new
  conversation" CTA)
- **Chat screen** with text, image and video bubbles, AI/agent labels,
  timestamps, system events ("Ticket created", "Connecting you with a
  teammate", etc.)
- **Tickets tab** showing the visitor's submitted tickets
- **Header** with the brand's assistant name, AI/agent subtitle, back +
  close buttons
- **Brand color** is pulled from your dashboard automatically — pass
  `theme={{ ... }}` to override anything else.

### Just the chat (no list / no tabs)

If you only want the chat surface inside your own screen:

```tsx
<SupportsProvider options={{ widgetId: "wgt_xxx" }}>
  <SupportsChat onPickAttachment={() => pickImage()} />
</SupportsProvider>
```

---

## New-message notifications

The SDK can show the same polished "Reply from Support..." peek bubble as the
web widget while your chat UI is closed. It uses the brand color from your
dashboard, coalesces bursts into one bubble with `+N`, auto-dismisses after 6
seconds, and keeps the unread badge until the chat opens.

Use the built-in pieces when you render your own launcher:

```tsx
import {
  LauncherBadge,
  PeekBubble,
  SupportsProvider,
  useUnread,
} from "@postpaddy/supports-react-native";

function SupportLauncher({ conversationId, visitorToken, openChat, isOpen }) {
  const unread = useUnread({ conversationId, visitorToken, isOpen });

  return (
    <>
      <PeekBubble
        message={unread.latestMessage}
        unreadCount={unread.count}
        brandColor="#149DFF"
        onOpen={() => {
          unread.markSeen(visitorToken);
          openChat();
        }}
      />

      <Pressable onPress={openChat}>
        <Text>Support</Text>
        <LauncherBadge count={unread.count} color="#149DFF" />
      </Pressable>
    </>
  );
}

export default function App() {
  return (
    <SupportsProvider
      options={{
        widgetId: "wgt_xxx",
        notifications: {
          peek: true,
          sound: "ask",  // "ask" | "on" | "off"
          haptic: "ask", // "ask" | "on" | "off"
        },
      }}
    >
      <SupportLauncher />
    </SupportsProvider>
  );
}
```

`sound: "ask"` and `haptic: "ask"` show a one-time inline prompt on the first
incoming message. The visitor's choice is persisted locally and is not asked
again. Brand admins can also set defaults in Postpaddy dashboard -> Messenger
-> Chat notifications; pass explicit provider options if your app needs to
override those defaults.

Call `unread.markSeen()` when the chat opens or when the visitor taps the peek
bubble. That updates the backend via `widget-mark-seen`, clears local unread
state, and keeps unread behavior consistent across sessions.

---

## Identifying the visitor

If you don't call `identify()`, the visitor is created as an **anonymous
guest** with a stable handle like `Guest · 7K3QF` (deterministic from the
device's local visitor id, so it stays stable across sessions and app
restarts). Your agents see this name in the inbox until you upgrade the
contact:

```ts
import { createSupportsClient } from "@postpaddy/supports-react-native";
const client = createSupportsClient({ widgetId: "wgt_xxx" });

// Whenever you have the user's info (e.g. after they log in), upgrade:
await client.identify({
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+1 555 0100",         // optional
  company: "Analytical Engines", // optional
  external_user_id: "user_42",   // your internal id — optional
  preferred_language: "fr",      // optional, see "Translation" below
});
```

All fields are optional. `identify()` and `<SupportsMessenger identity={...}>`
accept the exact same shape.

### Translation

Pass a `defaultLanguage` on the provider to set the brand's working language,
or `preferred_language` per visitor. Replies from the AI/agent are translated
to the visitor's language automatically — the same translation rules used by
the web widget apply (auto-detect on first message, stops translating once
both sides are typing in the same language, resumes if the visitor switches).

You can also change it at runtime: `await client.setLanguage(visitorToken, "es")`.

---

## How messages flow (so you don't get surprised)

The SDK is a **thin wrapper** around the same backend the web widget uses.
There is no local DB and no message echo from the send endpoint — instead:

1. `sendMessage()` POSTs to `widget-send-message` and resolves with
   `{ reply, escalated }` (the AI's reply text, if any).
2. The persisted **visitor message row** and the **AI / agent reply row**
   arrive over **realtime** via `subscribeMessages()`.
3. `<SupportsChat />` and `<SupportsMessenger />` already wire realtime up
   for you — every new row shows in the list automatically.

> Realtime is best-effort. If you skip `@supabase/supabase-js`, or your
> network/RLS blocks the websocket, the built-in components fall back to
> polling `loadHistory()` every 5 seconds so agent replies still arrive —
> just with a small delay. Install `@supabase/supabase-js` for instant updates.

---

## Sending images, videos, and camera captures

The SDK ships optional one-call helpers (require `expo-image-picker`):

```tsx
import {
  useConversation,
  pickAndSendImage,
  pickAndSendVideo,
  captureAndSend,
} from "@postpaddy/supports-react-native";

function Composer() {
  const { send, sending } = useConversation();
  return (
    <>
      <Button title="Photo"  onPress={() => pickAndSendImage({ send })} />
      <Button title="Video"  onPress={() => pickAndSendVideo({ send })} />
      <Button title="Camera" onPress={() => captureAndSend({ send, kind: "image" })} />
    </>
  );
}
```

If you'd rather preview before sending, use the lower-level pickers — they
return `AttachmentInput[]` you can pass to `sendMessage` yourself:

```ts
import { pickImage } from "@postpaddy/supports-react-native";

// Multi-select up to 10 images in one go
const attachments = await pickImage({ multiple: true, selectionLimit: 10 });
await client.sendMessage({ visitorToken, text: "Here are the receipts", attachments });
```

### Multiple attachments per message

Yes — multiple images (and mixed image + video) in a single message are
fully supported end-to-end:

- `pickImage({ multiple: true, selectionLimit: N })` returns up to N assets
  in one picker session.
- `client.sendMessage({ attachments })` accepts the full array; each file
  is uploaded to GCS in parallel, then the message is persisted with all
  attachments attached.
- The built-in `<SupportsMessenger />` composer lets the visitor stack up
  to **10 attachments** before tapping send — tap the 📎 button repeatedly
  to add more, tap × on a thumbnail to remove one.
- Both bubble renderers (`<SupportsMessenger />` and `<SupportsChat />`)
  render every attachment in the message, so a multi-image send appears as
  a stack of images inside one bubble.

Permission prompts and HEIC → JPEG conversion are handled for you. Bring
your own picker (PHPicker, `react-native-image-picker`, etc.) by skipping
these helpers and constructing `AttachmentInput` directly: `{ uri, mime,
kind: "image" | "video", size_bytes, width?, height?, duration_ms? }`. Local
`file://` URIs are uploaded to GCS automatically; pass an `https://` URL
that's already hosted to skip the upload.

---

## Headless usage (no UI)

If you want to roll your own UI, the same client powers everything:

```ts
import { createSupportsClient } from "@postpaddy/supports-react-native";

const client = createSupportsClient({ widgetId: "wgt_xxx" });

await client.identify({ name: "Ada", email: "ada@example.com" });
const { visitorToken, conversation } = await client.startConversation();
const { messages } = await client.loadHistory(visitorToken);

const unsubscribe = client.subscribeMessages(conversation.id, (msg, event) => {
  // event is "INSERT" | "UPDATE"
  console.log(event, msg);
});

await client.sendMessage({ visitorToken, text: "Hi!" });
// → resolves with { reply, escalated }. The actual rows arrive via subscribeMessages.

unsubscribe();
```

Returning visitors:

```ts
const list = await client.listConversations();        // requires identify()
const opened = await client.openConversation(list[0].id);
```

### API reference

| Method | Backend call |
|---|---|
| `bootstrap()` | `GET /widget-bootstrap?widget_id=…` |
| `identify(input)` / `startConversation(input?)` | `POST /widget-start` |
| `openConversation(id)` | `POST /widget-open-conversation` |
| `listConversations()` | `GET /widget-resume?widget_id=…&contact_token=…` |
| `loadHistory(visitorToken)` | `POST /widget-history` |
| `markSeen(visitorToken)` | `POST /widget-mark-seen` |
| `sendMessage({ visitorToken, text, attachments })` | `POST /chat-upload-sign` (per file) → `PUT` to GCS → `POST /widget-send-message` |
| `setLanguage(visitorToken, lang)` | `POST /widget-set-language` |
| `listTickets(visitorToken)` | `POST /widget-tickets` |
| `subscribeMessages(convId, cb)` | Realtime `messages` table filtered by `conversation_id` |
| `reset()` | Clears stored `contact_token` + `visitor_uid` |

The complete backend contract lives in
[`docs/postpaddy-mobile-spec.md`](../../docs/postpaddy-mobile-spec.md).

---

## Custom storage (advanced)

By default the SDK persists `contact_token` and `visitor_uid` with
AsyncStorage. Pass your own adapter to use Keychain / EncryptedSharedPrefs
or to mock in tests:

```ts
import { SupportsProvider, type SupportsStorage } from "@postpaddy/supports-react-native";

const keychainStorage: SupportsStorage = {
  async getItem(key)        { /* ... */ },
  async setItem(key, value) { /* ... */ },
  async removeItem(key)     { /* ... */ },
};

<SupportsProvider options={{ widgetId: "wgt_xxx", storage: keychainStorage }}>
```

---

## Why no API keys?

Like Intercom, Crisp, and HelpScout's mobile SDKs, you only ever provide
your **widget id**. All auth happens server-side via short-lived visitor
tokens scoped to your widget, and Row-Level Security prevents any
cross-tenant access. Rotating the widget id is a dashboard action — the SDK
needs no rebuild.

---

## Troubleshooting

- **"widgetId is required"** — pass `widgetId` to `<SupportsProvider options={{ widgetId }} />` or `createSupportsClient({ widgetId })`.
- **Messages feel delayed (3–5s)** — that's the polling fallback. Install `@supabase/supabase-js` to enable instant realtime updates.
- **Attachments aren't showing** — the built-in `<SupportsMessenger />` and `<SupportsChat />` already handle both `metadata.attachments[]` and the legacy single `attachment_url` field. If you render messages yourself, check both.
- **`pickImage()` throws "expo-image-picker not installed"** — `npx expo install expo-image-picker`, or bring your own picker and build `AttachmentInput` yourself.
- **Anonymous visitor showing as `Guest · XXXXX` in the inbox** — call `client.identify({ name, email })` to upgrade them.
- **Same conversation keeps appearing** — call `client.reset()` to clear the visitor's `contact_token` (e.g. on logout).
