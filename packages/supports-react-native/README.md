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

> If you skip installing `@supabase/supabase-js`, realtime is disabled.
> Messages still send, but new incoming messages won't appear until you call
> `loadHistory()` again. Install it.

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

const attachments = await pickImage({ multiple: true });
await client.sendMessage({ visitorToken, text: "Here's the receipt", attachments });
```

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
- **Messages don't appear in real time** — install `@supabase/supabase-js`.
- **`pickImage()` throws "expo-image-picker not installed"** — `npx expo install expo-image-picker`, or bring your own picker and build `AttachmentInput` yourself.
- **Anonymous visitor showing as `Guest · XXXXX` in the inbox** — call `client.identify({ name, email })` to upgrade them.
- **Same conversation keeps appearing** — call `client.reset()` to clear the visitor's `contact_token` (e.g. on logout).
