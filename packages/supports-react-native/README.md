# @postpaddy/supports-react-native

React Native SDK for **Postpaddy Supports** — drop-in customer chat (with the
AI assistant + human handoff) for any React Native app. Same backend as the
Postpaddy web widget.

## Install

```sh
npm i @postpaddy/supports-react-native
```

That's it. AsyncStorage is bundled. Optional extras:

```sh
# realtime live updates (recommended)
npm i @supabase/supabase-js
# built-in image/video picker helpers
npx expo install expo-image-picker
```

## Quick start — full messenger

```tsx
import { SupportsProvider, SupportsMessenger, pickImage } from "@postpaddy/supports-react-native";

export default function App() {
  return (
    <SupportsProvider options={{ widgetId: "wgt_xxx", defaultLanguage: "en" }}>
      <SupportsMessenger
        identity={{ name: "Ada", email: "ada@example.com" }}  // optional
        onPickAttachment={() => pickImage({ multiple: true })}
        onClose={() => { /* close your modal/sheet */ }}
      />
    </SupportsProvider>
  );
}
```

`<SupportsMessenger />` is the full screen the visitor sees in the screenshots:

- **Conversations list** for returning visitors (with "Start a new conversation" CTA)
- **Chat screen** with text + image + video bubbles, AI/agent labels, timestamps, system events ("Ticket created", "Connecting you with a teammate", etc.)
- **Tickets tab** with the visitor's submitted tickets
- **Header** with brand assistant name, AI/agent subtitle, back + close buttons

Everything is themable via the `theme` prop and uses the brand's color from your dashboard automatically.

### Just the chat (no list / tabs)

If you want to drop only the chat into your own screen, use `<SupportsChat />`:

```tsx
<SupportsProvider options={{ widgetId: "wgt_xxx" }}>
  <SupportsChat onPickAttachment={() => pickImage()} />
</SupportsProvider>
```

That's the whole integration. **Only `widgetId` is required.**

### Anonymous by default

If you don't call `identify()`, the visitor is created as an anonymous guest
with a generated handle like `Guest · 7K3QF` (deterministic from the device's
local visitor id, so it stays stable across sessions). Agents see this name
in the inbox until you upgrade the contact via `identify()`.

```ts
// Whenever you have the user's info (e.g. after they log in), upgrade:
await client.identify({ name: "Ada", email: "ada@example.com" });
```

`identify()` accepts `{ name, email, phone, company, external_user_id, preferred_language }` — all optional. You can also pass a project-wide default via `options.defaultLanguage` on the provider; the AI/agent's replies are then translated for the visitor automatically (per our translation rules — visitor switches resume translation, no-op once both sides are speaking the brand's language).

### Why no API keys?

The SDK ships with the Postpaddy backend URL baked in. Like Intercom, Crisp,
and HelpScout's mobile SDKs, you only ever provide your **widget id**. All
auth happens server-side via short-lived visitor tokens scoped to your widget,
and Row-Level Security prevents any cross-tenant access.

## Headless usage

```ts
import { createSupportsClient } from "@postpaddy/supports-react-native";

const client = createSupportsClient({ widgetId: "wgt_xxx" });

await client.identify({ name: "Ada", email: "ada@example.com" });
const { visitorToken, conversation } = await client.startConversation();
const { messages } = await client.loadHistory(visitorToken);
const unsub = client.subscribeMessages(conversation.id, (m) => console.log(m));
await client.sendMessage({ visitorToken, text: "Hi!" });
```

## API

| Method | Calls |
|---|---|
| `bootstrap()` | `POST /widget-bootstrap` |
| `identify(input)` / `startConversation(input?)` | `POST /widget-start` |
| `openConversation(id)` | `POST /widget-open-conversation` |
| `listConversations()` | `POST /widget-resume` |
| `loadHistory(token)` | `POST /widget-history` |
| `sendMessage({ token, text, attachments })` | `POST /chat-upload-sign` (per attachment) → `PUT` to GCS → `POST /widget-send-message` |
| `setLanguage(token, lang)` | `POST /widget-set-language` |
| `subscribeMessages(convId, cb)` | Realtime `messages` table filtered by conversation |
| `reset()` | Clears stored `contact_token` + `visitor_uid` |

The full backend contract is documented in
[`docs/postpaddy-mobile-spec.md`](../../docs/postpaddy-mobile-spec.md).

## Built-in image picker (optional)

Install `expo-image-picker` and the SDK exposes one-call helpers:

```tsx
import { useConversation, pickAndSendImage, captureAndSend, pickAndSendVideo } from "@postpaddy/supports-react-native";

function Composer() {
  const { send, sending } = useConversation();
  return (
    <>
      <Button title="Photo"  onPress={() => pickAndSendImage({ send })} />
      <Button title="Camera" onPress={() => captureAndSend({ send, kind: "image" })} />
      <Button title="Video"  onPress={() => pickAndSendVideo({ send })} />
    </>
  );
}
```

Lower-level helpers (`pickImage`, `pickVideo`, `captureFromCamera`) return
`AttachmentInput[]` you can pass to `client.sendMessage({ ..., attachments })`
yourself if you want to preview before sending. iOS HEIC photos are converted
to JPEG automatically. All helpers handle permission prompts.

## Custom storage (advanced)

By default the SDK persists the visitor's `contact_token` with AsyncStorage.
Pass your own adapter if you want secure storage (e.g. Keychain) or testing:

```ts
import { SupportsProvider, type SupportsStorage } from "@postpaddy/supports-react-native";

const keychainStorage: SupportsStorage = { getItem, setItem, removeItem };

<SupportsProvider options={{ widgetId: "wgt_xxx", storage: keychainStorage }}>
```
