// Public API for @postpaddy/supports-react-native.
//
// Two layers:
//   • Headless:  createSupportsClient(), useSupports(), useConversation()
//   • UI:        <SupportsChat /> drop-in screen
//
// Everything talks to the same Postpaddy Supports backend the web widget uses,
// so the API contract is shared across all SDKs (RN, iOS, Android).
export { createSupportsClient } from "./client";
export { createMemoryStorage } from "./storage";
export type {
  SupportsClient,
  SupportsClientOptions,
  SupportsStorage,
  WidgetConfig,
  WidgetTicket,
  StartConversationInput,
  IdentifyInput,
  Conversation,
  Message,
  Attachment,
  AttachmentInput,
  RealtimeUnsubscribe,
} from "./types";

export { SupportsProvider, useSupports, useSupportsNotifications } from "./SupportsProvider";
export type { SupportsProviderOptions, SupportsNotificationOptions, NotificationMode } from "./SupportsProvider";
export { useConversation } from "./useConversation";
export { useUnread } from "./useUnread";
export type { UnreadState } from "./useUnread";
export { PeekBubble, LauncherBadge } from "./PeekBubble";
export type { PeekBubbleProps } from "./PeekBubble";
export { playNotificationSound, triggerNotificationHaptic } from "./notify";
export { SupportsChat } from "./SupportsChat";
export type { SupportsChatTheme, SupportsChatProps } from "./SupportsChat";
export { SupportsMessenger } from "./SupportsMessenger";
export type { SupportsMessengerTheme, SupportsMessengerProps } from "./SupportsMessenger";

// Optional picker helpers (require `expo-image-picker` at runtime).
export {
  pickImage,
  pickVideo,
  captureFromCamera,
  pickAndSendImage,
  pickAndSendVideo,
  captureAndSend,
} from "./picker";
export type { PickOptions } from "./picker";
