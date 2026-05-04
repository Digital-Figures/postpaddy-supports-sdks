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

## Quick start

```tsx
import { SupportsProvider, SupportsChat } from "@postpaddy/supports-react-native";

export default function App() {
  return (
    <SupportsProvider options={{ widgetId: "wgt_xxx" }}>
      <SupportsChat
        identity={{ name: "Ada", email: "ada@example.com" }}
        theme={{ primary: "#1f2bff" }}
      />
    </SupportsProvider>
  );
}
```

That's the whole integration. **Only `widgetId` is required.** Identity is
optional — pass any combination of `{ name, email, phone, external_user_id }`
when you want to attach the chat to a known user.

If you need to point the SDK at a different Supports backend or wire storage
explicitly, `SupportsProvider` and `createSupportsClient()` also accept
optional `supabaseUrl`, `supabaseAnonKey`, and `storage` overrides.

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

## Optional: built-in image picker

The SDK ships convenience helpers that wrap `expo-image-picker`. Install it in
your app to use them (it's an *optional* peer dep):

```bash
npx expo install expo-image-picker
```

```tsx
import {
  useConversation,
  pickAndSendImage,
  captureAndSend,
  pickAndSendVideo,
} from "@postpaddy/supports-react-native";

function Composer() {
  const { send } = useConversation();
  return (
    <>
      <Button title="Photo" onPress={() => pickAndSendImage({ send, text: "" })} />
      <Button title="Camera" onPress={() => captureAndSend({ send, kind: "image" })} />
      <Button title="Video" onPress={() => pickAndSendVideo({ send })} />
    </>
  );
}
```

Lower-level helpers (`pickImage`, `pickVideo`, `captureFromCamera`) return
`AttachmentInput[]` you can pass to `client.sendMessage({ ..., attachments })`
yourself if you want to preview before sending. All helpers handle permission
prompts and convert picker results (uri/mime/width/height/duration/size) into
the SDK's attachment shape.

If your app prefers to supply its own storage adapter, you can also export one
from `@react-native-async-storage/async-storage`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { asyncStorageAdapter, createSupportsClient } from "@postpaddy/supports-react-native";

const client = createSupportsClient({
  widgetId: "wgt_xxx",
  storage: asyncStorageAdapter(AsyncStorage),
});
```

The full backend contract is documented in
[`docs/postpaddy-mobile-spec.md`](../../docs/postpaddy-mobile-spec.md) and the
v1.0.10 deltas in
[`docs/postpaddy-mobile-spec-v1.0.10-adds.md`](../../docs/postpaddy-mobile-spec-v1.0.10-adds.md).
