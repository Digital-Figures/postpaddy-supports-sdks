// Headless client — pure REST + realtime calls. No React, no UI.
// Safe to use from RN, web, Node, anywhere.
import type {
  SupportsClient,
  SupportsClientOptions,
  WidgetConfig,
  IdentifyInput,
  StartConversationInput,
  Conversation,
  Message,
  AttachmentInput,
  Attachment,
  RealtimeUnsubscribe,
  WidgetTicket,
} from "./types";
import { createDefaultStorage } from "./storage";
import { SUPPORTS_SUPABASE_URL, SUPPORTS_SUPABASE_ANON_KEY } from "./config";

const TOKEN_KEY = "postpaddy:supports:contact_token";
const VUID_KEY = "postpaddy:supports:visitor_uid";

export function createSupportsClient(opts: SupportsClientOptions): SupportsClient {
  if (!opts?.widgetId) throw new Error("createSupportsClient: `widgetId` is required");
  const storage = opts.storage ?? createDefaultStorage();
  const fetchImpl = opts.fetch ?? fetch;
  const fnBase = `${SUPPORTS_SUPABASE_URL}/functions/v1`;

  const baseHeaders: Record<string, string> = {
    "content-type": "application/json",
    apikey: SUPPORTS_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPPORTS_SUPABASE_ANON_KEY}`,
  };

  async function call<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const res = await fetchImpl(`${fnBase}/${path}`, {
      method: "POST",
      headers: { ...baseHeaders, ...(extraHeaders ?? {}) },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* not json */ }
    if (!res.ok) {
      throw new Error(json?.error || `Supports ${path} failed (${res.status})`);
    }
    return json as T;
  }

  async function getOrCreateVisitorUid(): Promise<string> {
    let v = await storage.getItem(VUID_KEY);
    if (!v) {
      v = `vuid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await storage.setItem(VUID_KEY, v);
    }
    return v;
  }

  async function getContactToken(): Promise<string | null> {
    return storage.getItem(TOKEN_KEY);
  }

  async function uploadAttachment(visitorToken: string, a: AttachmentInput): Promise<Attachment> {
    // Already uploaded somewhere? Pass through.
    if (/^https?:\/\//i.test(a.uri)) {
      return {
        url: a.uri, mime: a.mime, kind: a.kind,
        width: a.width, height: a.height, duration_ms: a.duration_ms,
      };
    }

    // 1) Sign
    const signed = await call<{ upload_url: string; public_url: string }>(
      "chat-upload-sign",
      { kind: a.kind, mime_type: a.mime, size_bytes: a.size_bytes },
      { "x-visitor-token": visitorToken },
    );

    // 2) PUT bytes — RN supports passing { uri } directly to fetch as the body
    //    via FormData, but for a single binary the simplest is to read+blob.
    const fileRes = await fetchImpl(a.uri);
    const blob = await fileRes.blob();
    const putRes = await fetchImpl(signed.upload_url, {
      method: "PUT",
      headers: { "content-type": a.mime },
      body: blob as any,
    });
    if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

    return {
      url: signed.public_url, mime: a.mime, kind: a.kind,
      width: a.width, height: a.height, duration_ms: a.duration_ms,
    };
  }

  // Realtime is optional — only loaded if the host app passes supabase-js.
  let _supabase: any = null;
  async function getSupabase() {
    if (_supabase) return _supabase;
    try {
      const mod = await import("@supabase/supabase-js");
      _supabase = mod.createClient(SUPPORTS_SUPABASE_URL, SUPPORTS_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      return _supabase;
    } catch {
      throw new Error(
        "subscribeMessages requires @supabase/supabase-js. Install it in your app.",
      );
    }
  }

  return {
    async bootstrap(): Promise<WidgetConfig> {
      return call<WidgetConfig>("widget-bootstrap", { widget_id: opts.widgetId });
    },

    async identify(input: IdentifyInput): Promise<void> {
      // identify() only persists the contact_token by calling widget-start with
      // the provided identity. The minted conversation is discarded; the next
      // startConversation() returns a fresh one tied to the same contact.
      const visitor_uid = await getOrCreateVisitorUid();
      const res = await call<{ contact_token: string }>("widget-start", {
        widget_id: opts.widgetId,
        visitor_uid,
        ...input,
      });
      if (res?.contact_token) await storage.setItem(TOKEN_KEY, res.contact_token);
    },

    async isIdentified(): Promise<boolean> {
      return (await getContactToken()) != null;
    },

    async startConversation(input?: StartConversationInput) {
      const contact_token = await getContactToken();
      const visitor_uid = await getOrCreateVisitorUid();
      const merged: StartConversationInput = {
        ...(opts.defaultLanguage ? { preferred_language: opts.defaultLanguage } : {}),
        ...(input ?? {}),
      };
      const res = await call<{
        visitor_token: string;
        conversation_id: string;
        contact_token?: string;
        visitor_language?: string | null;
      }>("widget-start", {
        widget_id: opts.widgetId,
        visitor_uid,
        ...(contact_token ? { contact_token } : {}),
        ...merged,
      });
      if (res.contact_token) await storage.setItem(TOKEN_KEY, res.contact_token);
      return {
        visitorToken: res.visitor_token,
        conversation: {
          id: res.conversation_id,
          visitor_language: res.visitor_language ?? null,
        },
      };
    },

    async openConversation(conversation_id: string) {
      const contact_token = await getContactToken();
      if (!contact_token) throw new Error("Call identify() before openConversation()");
      const res = await call<{
        visitor_token: string;
        conversation_id: string;
        visitor_language?: string | null;
      }>("widget-open-conversation", {
        widget_id: opts.widgetId,
        contact_token,
        conversation_id,
      });
      return {
        visitorToken: res.visitor_token,
        conversation: { id: res.conversation_id, visitor_language: res.visitor_language ?? null },
      };
    },

    async listConversations(): Promise<Conversation[]> {
      const contact_token = await getContactToken();
      if (!contact_token) throw new Error("Call identify() before listConversations()");
      // widget-resume is a GET with query params (matches the web widget).
      const url = `${fnBase}/widget-resume?widget_id=${encodeURIComponent(opts.widgetId)}&contact_token=${encodeURIComponent(contact_token)}`;
      const res = await fetchImpl(url, { headers: baseHeaders });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `widget-resume failed (${res.status})`);
      return (json?.conversations ?? []) as Conversation[];
    },

    async listTickets(visitorToken: string) {
      const res = await call<{ tickets: WidgetTicket[]; visible: boolean }>(
        "widget-tickets", {}, { "x-visitor-token": visitorToken },
      );
      return { tickets: res?.tickets ?? [], visible: !!res?.visible };
    },

    async loadHistory(visitorToken: string) {
      const res = await call<{ conversation_id: string; messages: Message[] }>(
        "widget-history",
        {},
        { "x-visitor-token": visitorToken },
      );
      // Defensive: backend has occasionally returned null entries / messages
      // missing an id. Filter them out so consumers can safely keyExtract.
      const messages = Array.isArray(res?.messages)
        ? res.messages.filter((m): m is Message => !!m && typeof m.id === "string")
        : [];
      return { conversation_id: res?.conversation_id, messages };
    },

    async sendMessage({ visitorToken, text, attachments }) {
      const uploaded: Attachment[] = [];
      if (attachments?.length) {
        for (const a of attachments) {
          uploaded.push(await uploadAttachment(visitorToken, a));
        }
      }
      const res = await call<{ message: Message; ai_message?: Message | null }>(
        "widget-send-message",
        { message: text ?? "", attachments: uploaded },
        { "x-visitor-token": visitorToken },
      );
      const message = res?.message && typeof res.message.id === "string" ? res.message : null;
      if (!message) throw new Error("widget-send-message returned no message");
      const ai = res?.ai_message && typeof res.ai_message.id === "string" ? res.ai_message : null;
      return { message, aiMessage: ai };
    },

    async setLanguage(visitorToken, language) {
      await call("widget-set-language", { language }, { "x-visitor-token": visitorToken });
    },

    subscribeMessages(conversationId, handler): RealtimeUnsubscribe {
      let channel: any = null;
      let cancelled = false;
      (async () => {
        const sb = await getSupabase();
        if (cancelled) return;
        channel = sb.channel(`supports-msgs-${conversationId}`)
          .on("postgres_changes", {
            event: "INSERT", schema: "public", table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          }, (payload: any) => handler(payload.new as Message, "INSERT"))
          .on("postgres_changes", {
            event: "UPDATE", schema: "public", table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          }, (payload: any) => handler(payload.new as Message, "UPDATE"))
          .subscribe();
      })();
      return () => {
        cancelled = true;
        if (channel && _supabase) _supabase.removeChannel(channel);
      };
    },

    async reset() {
      await storage.removeItem(TOKEN_KEY);
      await storage.removeItem(VUID_KEY);
    },
  };
}
