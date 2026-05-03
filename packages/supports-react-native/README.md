# @postpaddy/supports-react-native

React Native SDK for **Postpaddy Supports** — chat with your customers (and the AI assistant) from inside any React Native app. Same backend the web widget uses.

## Install

```sh
npm i @postpaddy/supports-react-native
# Required for realtime + recommended for storage
npm i @supabase/supabase-js @react-native-async-storage/async-storage
```

## Quick start

```tsx
import {
  SupportsProvider,
  SupportsChat,
  asyncStorageAdapter,
} from "@postpaddy/supports-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const options = {
  widgetId: "wgt_xxx",
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "eyJ...",
  storage: asyncStorageAdapter(AsyncStorage),
};

export default function App() {
  return (
    <SupportsProvider options={options}>
      <SupportsChat
        identity={{ name: "Ada", email: "ada@example.com" }}
        onPickAttachment={pickFromImagePicker}
        theme={{ primary: "#1f2bff" }}
      />
    </SupportsProvider>
  );
}
```

`onPickAttachment` is your hook to call `expo-image-picker` /
`react-native-image-picker`. It must return `{ uri, mime, kind, size_bytes }[]`
where `uri` is a local `file://`. **For iOS HEIC photos, convert to JPEG
before passing them in** — Android/web cannot decode HEIC.

```ts
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

async function pickFromImagePicker() {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.85 });
  if (r.canceled || !r.assets?.length) return null;
  return Promise.all(r.assets.map(async (a) => {
    let uri = a.uri, mime = a.mimeType ?? (a.type === "video" ? "video/mp4" : "image/jpeg");
    if (mime === "image/heic" || mime === "image/heif") {
      const out = await ImageManipulator.manipulateAsync(uri, [], {
        format: ImageManipulator.SaveFormat.JPEG, compress: 0.85,
      });
      uri = out.uri; mime = "image/jpeg";
    }
    return {
      uri, mime,
      kind: a.type === "video" ? "video" as const : "image" as const,
      size_bytes: a.fileSize ?? 0,
      width: a.width, height: a.height,
      duration_ms: a.duration ?? undefined,
    };
  }));
}
```

## Headless usage

```ts
import { createSupportsClient } from "@postpaddy/supports-react-native";

const client = createSupportsClient(options);
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
[`docs/postpaddy-mobile-spec.md`](../../docs/postpaddy-mobile-spec.md) and the
v1.0.10 deltas in
[`docs/postpaddy-mobile-spec-v1.0.10-adds.md`](../../docs/postpaddy-mobile-spec-v1.0.10-adds.md).
