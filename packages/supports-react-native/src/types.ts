// Shared type contract — mirrors the backend's edge-function payloads.
// If you change a field here, make the corresponding edge-function change too.

export type SupportsClientOptions = {
  /** Postpaddy widget id (from your dashboard). The ONLY required option. */
  widgetId: string;
  /**
   * Optional storage override. Defaults to AsyncStorage on RN (bundled),
   * falls back to in-memory if AsyncStorage isn't available.
   */
  storage?: SupportsStorage;
  /** Optional fetch override (polyfill, telemetry, custom timeouts). */
  fetch?: typeof fetch;
  /**
   * Optional default language code (e.g. "en", "fr", "es"). When set, new
   * conversations start in this language and the AI/agent's replies are
   * translated for the visitor automatically. Visitors can change it later
   * via setLanguage().
   */
  defaultLanguage?: string;
};

export type WidgetTicket = {
  id: string;
  ticket_number: string;
  subject: string;
  status: string;
  created_at: string;
};

export interface SupportsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type WidgetConfig = {
  brand_id: string;
  brand_name: string;
  brand_color?: string | null;
  assistant_name?: string | null;
  identity_fields?: { name?: boolean; email?: boolean; phone?: boolean; company?: boolean };
};

export type IdentifyInput = {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  external_user_id?: string;
  preferred_language?: string;
};

export type StartConversationInput = IdentifyInput & {
  /** Anonymous device-stable id used when no email is provided. */
  visitor_uid?: string;
};

export type AttachmentKind = "image" | "video";

export type Attachment = {
  url: string;
  mime: string;
  kind: AttachmentKind;
  width?: number;
  height?: number;
  duration_ms?: number;
  description?: string;
};

/** What the host app passes into sendMessage(). Local file URI is converted to GCS. */
export type AttachmentInput = {
  /** Local file:// uri OR a remote https:// URL already uploaded. */
  uri: string;
  mime: string;
  kind: AttachmentKind;
  size_bytes: number;
  width?: number;
  height?: number;
  duration_ms?: number;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender: "customer" | "agent" | "ai" | "system";
  sender_name?: string | null;
  content: string | null;
  translated_content?: string | null;
  original_language?: string | null;
  translated_language?: string | null;
  attachment_url?: string | null;
  metadata?: { attachments?: Attachment[] } & Record<string, unknown>;
  created_at: string;
};

export type Conversation = {
  id: string;
  status?: string | null;
  visitor_language?: string | null;
  last_message_at?: string | null;
  summary?: string | null;
  is_escalated?: boolean;
  preview?: { content: string | null; sender: string; created_at: string } | null;
};

export type RealtimeUnsubscribe = () => void;

export interface SupportsClient {
  /** Fetch the brand's widget config (name, color, identity fields). */
  bootstrap(): Promise<WidgetConfig>;
  /** Identify the current visitor (persists contact_token). */
  identify(input: IdentifyInput): Promise<void>;
  /** Returns true once a contact_token is present. */
  isIdentified(): Promise<boolean>;
  /** Start a NEW conversation. Requires identify() first OR pass identity inline. */
  startConversation(input?: StartConversationInput): Promise<{ conversation: Conversation; visitorToken: string }>;
  /** Re-open a past conversation by id. */
  openConversation(conversationId: string): Promise<{ conversation: Conversation; visitorToken: string }>;
  /** List the visitor's past conversations (requires identify()). */
  listConversations(): Promise<Conversation[]>;
  /** List the visitor's tickets (requires an active visitor token). */
  listTickets(visitorToken: string): Promise<{ tickets: WidgetTicket[]; visible: boolean }>;
  /** Load full message history for a conversation. */
  loadHistory(visitorToken: string): Promise<{ conversation_id: string; messages: Message[] }>;
  /**
   * Send a message (text and/or attachments). Local file URIs are uploaded first.
   *
   * NOTE: The persisted visitor message and the AI reply are NOT returned here.
   * They arrive via `subscribeMessages()` (realtime). This call only returns
   * the AI's reply text (if any) and whether the conversation was escalated.
   */
  sendMessage(args: {
    visitorToken: string;
    text?: string;
    attachments?: AttachmentInput[];
  }): Promise<{ reply: string | null; escalated: boolean }>;
  /** Set the visitor's preferred language for a conversation. */
  setLanguage(visitorToken: string, language: string): Promise<void>;
  /** Subscribe to realtime message inserts/updates for a conversation. */
  subscribeMessages(
    conversationId: string,
    handler: (msg: Message, event: "INSERT" | "UPDATE") => void,
  ): RealtimeUnsubscribe;
  /** Clear stored identity (logout). */
  reset(): Promise<void>;
}
