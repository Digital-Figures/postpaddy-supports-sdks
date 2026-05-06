// Full multi-screen messenger UI — mirrors the Postpaddy web widget:
//   • Conversations list (returning visitors)
//   • Chat screen (with attachments, language switching, system events)
//   • Tickets tab
//
// Drop it under <SupportsProvider> and you're done. No props required —
// everything is driven by the visitor's contact_token in storage. Optional
// `identity` lets you pre-fill name/email/language without showing a form.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator,
  Image, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Modal, type ViewStyle,
} from "react-native";

// Optional video player. Apps that install `expo-av` get inline playback;
// otherwise we fall back to a tap-to-open card.
let ExpoVideo: any = null;
let ExpoVideoResizeMode: any = "contain";
let getVideoThumbnailAsync: ((uri: string, options?: { time?: number }) => Promise<{ uri: string }>) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const av = require("expo-av");
  ExpoVideo = av?.Video ?? null;
  ExpoVideoResizeMode = av?.ResizeMode?.CONTAIN ?? "contain";
} catch {
  /* optional dependency not installed */
}
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const thumbs = require("expo-video-thumbnails");
  getVideoThumbnailAsync = thumbs?.getThumbnailAsync ?? null;
} catch {
  /* optional dependency not installed */
}
import { useSupports } from "./SupportsProvider";
import { SUPPORTS_SUPABASE_URL } from "./config";
import type {
  AttachmentInput, Conversation, Message, StartConversationInput,
  WidgetConfig, WidgetTicket,
} from "./types";

export type SupportsMessengerTheme = {
  background?: string;
  surface?: string;
  border?: string;
  text?: string;
  mutedText?: string;
  primary?: string;
  primaryText?: string;
  bubbleIncoming?: string;
  bubbleIncomingText?: string;
};

const defaults: Required<SupportsMessengerTheme> = {
  background: "#ffffff",
  surface: "#f5f7fa",
  border: "#e6e8ec",
  text: "#0f172a",
  mutedText: "#64748b",
  primary: "#149DFF",
  primaryText: "#ffffff",
  bubbleIncoming: "#ffffff",
  bubbleIncomingText: "#0f172a",
};

export type SupportsMessengerProps = {
  /** Optional pre-fill for new conversations: name/email/language/etc. */
  identity?: StartConversationInput;
  /** Hook the host app provides to pick image/video attachments. */
  onPickAttachment?: () => Promise<AttachmentInput[] | null>;
  theme?: SupportsMessengerTheme;
  style?: ViewStyle;
  /** Called when the visitor taps the X button. */
  onClose?: () => void;
};

type Screen =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "conversations" }
  | { name: "chat"; conversationId?: string }
  | { name: "tickets" };

type PreviewAttachment = { url: string; kind: "image" | "video"; mime?: string };
type ConvoCacheStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

const CONVO_CACHE_KEY = "pp_supports_recent_convos_v1";
let convoCacheStorage: ConvoCacheStorage | null = null;
function getConvoCacheStorage(): ConvoCacheStorage | null {
  if (convoCacheStorage) return convoCacheStorage;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@react-native-async-storage/async-storage");
    const s = mod?.default ?? mod;
    if (s?.getItem && s?.setItem) {
      convoCacheStorage = s as ConvoCacheStorage;
      return convoCacheStorage;
    }
  } catch {
    /* optional dependency missing */
  }
  return null;
}

function relativeTime(iso?: string | null) {
  if (!iso) return "just now";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function mediaSrc(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  return `${SUPPORTS_SUPABASE_URL}/functions/v1/chat-media?url=${encodeURIComponent(url)}`;
}

function VideoAttachment({
  url,
  mime,
  theme,
  onOpenAttachment,
}: {
  url: string;
  mime?: string;
  theme: Required<SupportsMessengerTheme>;
  onOpenAttachment: (a: PreviewAttachment) => void;
}) {
  const src = mediaSrc(url);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!getVideoThumbnailAsync) return;
    getVideoThumbnailAsync(src, { time: 1000 })
      .then((result) => {
        if (!cancelled) setThumbUrl(result?.uri ?? null);
      })
      .catch(() => {
        if (!cancelled) setThumbUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (ExpoVideo) {
    return (
      <TouchableOpacity
        onPress={() => onOpenAttachment({ url, kind: "video", mime })}
        style={[styles.videoCard, { borderColor: theme.border }]}
        activeOpacity={0.9}
      >
        <View style={{ width: "100%", height: "100%", backgroundColor: "#000" }} />
        <View style={styles.videoOverlay}>
          <Text style={styles.videoOverlayText}>Play video</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => onOpenAttachment({ url, kind: "video", mime })}
      style={[styles.videoCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
      activeOpacity={0.85}
    >
      {thumbUrl ? (
        <Image source={{ uri: thumbUrl }} style={styles.videoThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.videoThumb, styles.videoThumbFallback]}>
          <Text style={{ color: "#fff", fontSize: 34 }}>▶</Text>
        </View>
      )}
      <View style={styles.videoOverlay}>
        <Text style={styles.videoOverlayText}>Play video</Text>
      </View>
    </TouchableOpacity>
  );
}

export function SupportsMessenger({
  identity, onPickAttachment, theme, style, onClose,
}: SupportsMessengerProps) {
  const t = { ...defaults, ...(theme ?? {}) };
  const client = useSupports();

  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [tab, setTab] = useState<"messages" | "tickets">("messages");
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convosLoading, setConvosLoading] = useState(false);
  const [tickets, setTickets] = useState<WidgetTicket[]>([]);

  // Active conversation
  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [pending, setPending] = useState<AttachmentInput[]>([]);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PreviewAttachment | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  // Bootstrap: fetch brand config + load past conversations if any.
  // Always land on the Conversations screen so the visitor can either resume
  // an existing thread or tap "Start a new conversation". A first-time
  // anonymous visitor sees the same screen with an empty list — never gets
  // dropped straight into a chat.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bootstrapTask = (async () => {
          const cfg = await client.bootstrap();
          if (!cancelled) setConfig(cfg);
        })();
        const conversationTask = (async () => {
          const identified = await client.isIdentified();
          if (cancelled) return;
          setScreen({ name: "conversations" });
          if (!identified) return;
          setConvosLoading(true);
          const cache = getConvoCacheStorage();
          if (cache) {
            try {
              const raw = await cache.getItem(CONVO_CACHE_KEY);
              if (!cancelled && raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) setConversations(parsed as Conversation[]);
              }
            } catch { /* ignore cache parse/read issues */ }
          }
          try {
            const list = await client.listConversations();
            if (cancelled) return;
            setConversations(list);
            if (cache) {
              cache.setItem(CONVO_CACHE_KEY, JSON.stringify(list)).catch(() => {});
            }
          } catch { /* show empty or cached list */ }
          if (!cancelled) setConvosLoading(false);
        })();
        await Promise.all([bootstrapTask, conversationTask]);
      } catch (e: any) {
        if (!cancelled) setScreen({ name: "error", message: e?.message ?? String(e) });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      if (!(await client.isIdentified())) return;
      setConvosLoading(true);
      const list = await client.listConversations();
      setConversations(list);
      const cache = getConvoCacheStorage();
      if (cache) cache.setItem(CONVO_CACHE_KEY, JSON.stringify(list)).catch(() => {});
    } catch { /* ignore */ }
    finally { setConvosLoading(false); }
  }, [client]);

  async function openNewChat(initial = false) {
    setLoadingChat(true);
    setMessages([]);
    setVisitorToken(null);
    setScreen({ name: "chat" });
    try {
      const { visitorToken: vt, conversation } = await client.startConversation(identity);
      setVisitorToken(vt);
      const { messages: msgs } = await client.loadHistory(vt);
      setMessages(msgs);
      const unsub = client.subscribeMessages(conversation.id, (m) => upsert(m));
      unsubRef.current = unsub;
    } catch (e: any) {
      if (initial) setScreen({ name: "error", message: e?.message ?? String(e) });
      else setScreen({ name: "conversations" });
    } finally {
      setLoadingChat(false);
    }
  }

  async function openExisting(c: Conversation) {
    setLoadingChat(true);
    setMessages([]);
    setVisitorToken(null);
    setScreen({ name: "chat", conversationId: c.id });
    try {
      const { visitorToken: vt, conversation } = await client.openConversation(c.id);
      setVisitorToken(vt);
      const { messages: msgs } = await client.loadHistory(vt);
      setMessages(msgs);
      unsubRef.current?.();
      unsubRef.current = client.subscribeMessages(conversation.id, (m) => upsert(m));
    } catch (e: any) {
      setScreen({ name: "error", message: e?.message ?? String(e) });
    } finally {
      setLoadingChat(false);
    }
  }

  const unsubRef = useRef<null | (() => void)>(null);
  useEffect(() => () => { unsubRef.current?.(); }, []);

  function upsert(m: Message) {
    if (!m || typeof m.id !== "string") return;
    setMessages(prev => {
      // If a real DB row arrives that matches a local optimistic placeholder
      // (same sender + same content), replace ONE placeholder in place. We
      // only consume one placeholder per real row so multi-attachment sends
      // (which produce N rows from one placeholder, or 1 placeholder per
      // attachment from the SDK side) don't all collide on the same slot.
      const isReal = !m.id.startsWith("local_");
      let working = prev;
      if (isReal) {
        // Skip if this real id is already in the list (re-entrant realtime
        // + history reload + 5s polling can all race on the same row).
        if (working.some(x => x.id === m.id)) {
          // still merge any newer fields
          return dedupeById(working.map(x => x.id === m.id ? { ...x, ...m } : x));
        }
        const placeholderIdx = working.findIndex(x =>
          x.id.startsWith("local_") &&
          x.sender === m.sender &&
          (x.content ?? "") === (m.content ?? "")
        );
        if (placeholderIdx !== -1) {
          working = working.slice();
          working[placeholderIdx] = { ...working[placeholderIdx], ...m };
          return dedupeById(working);
        }
      }
      const idx = working.findIndex(x => x.id === m.id);
      if (idx === -1) return dedupeById([...working, m]);
      const next = working.slice();
      next[idx] = { ...next[idx], ...m };
      return dedupeById(next);
    });
  }

  // Final safety net: collapse any duplicate ids that slipped through due to
  // concurrent setState batches (realtime INSERT + post-send loadHistory +
  // 5s polling can all land in the same render window from different async
  // contexts, where each batch sees a stale `prev`). Keeps the first entry
  // and merges later occurrences into it so we never produce duplicate keys.
  function dedupeById(list: Message[]): Message[] {
    const seen = new Map<string, number>();
    const out: Message[] = [];
    for (const m of list) {
      const i = seen.get(m.id);
      if (i === undefined) {
        seen.set(m.id, out.length);
        out.push(m);
      } else {
        out[i] = { ...out[i], ...m };
      }
    }
    return out;
  }

  useEffect(() => {
    if (messages.length) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length]);

  // Tickets tab — load when opened, requires an active visitorToken.
  useEffect(() => {
    if (tab !== "tickets" || !visitorToken) return;
    client.listTickets(visitorToken).then(r => setTickets(r.tickets)).catch(() => {});
  }, [tab, visitorToken, client]);

  const accent = config?.brand_color || t.primary;

  async function handleSend() {
    if (!visitorToken) return;
    if (!text.trim() && pending.length === 0) return;
    const body = text;
    const atts = pending;
    setText(""); setPending([]);
    setSending(true);

    // Optimistic visitor bubble — appears instantly. Realtime will reconcile
    // it in place once the persisted row arrives (matched in upsert()).
    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const nowIso = new Date().toISOString();
    upsert({
      id: localId,
      conversation_id: "",
      sender: "customer",
      sender_name: null,
      content: body,
      created_at: nowIso,
      metadata: atts.length
        ? { attachments: atts.map(a => ({ kind: a.kind, url: a.uri, mime: a.mime })) }
        : undefined,
    } as Message);

    try {
      const res = await client.sendMessage({
        visitorToken, text: body, attachments: atts.length ? atts : undefined,
      });
      // Backend returns `{ reply, escalated }` (no row IDs). Show the AI reply
      // as an optimistic bubble so it appears instantly even if realtime is
      // delayed; the real row will replace this placeholder via upsert().
      if (res?.reply) {
        upsert({
          id: `local_ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          conversation_id: "",
          sender: "ai",
          sender_name: config?.assistant_name ?? null,
          content: res.reply,
          created_at: new Date().toISOString(),
        } as Message);
      }
      // Force a quick history reconciliation so attachments persisted by the
      // backend (which may live in `attachment_url` rather than `metadata.attachments`)
      // and any agent replies that didn't come through realtime show up.
      try {
        const hist = await client.loadHistory(visitorToken);
        hist.messages.forEach(upsert);
      } catch { /* ignore */ }
    } catch (e: any) {
      upsert({
        id: `err_${Date.now()}`,
        conversation_id: "",
        sender: "system",
        sender_name: null,
        content: `Error: ${e?.message ?? String(e)}`,
        created_at: new Date().toISOString(),
      } as Message);
    } finally {
      setSending(false);
    }
  }

  // Polling fallback — realtime can fail silently if the host app didn't
  // install @supabase/supabase-js, or if RLS / publication isn't reachable.
  // Without this, agent messages from the dashboard never appear. We poll
  // history every 5s while the chat screen is open and upsert any new rows.
  useEffect(() => {
    if (screen.name !== "chat" || !visitorToken) return;
    const id = setInterval(async () => {
      try {
        const hist = await client.loadHistory(visitorToken);
        hist.messages.forEach(upsert);
      } catch { /* ignore transient errors */ }
    }, 5000);
    return () => clearInterval(id);
  }, [screen.name, visitorToken, client]);

  async function handleAttach() {
    if (!onPickAttachment) return;
    const picked = await onPickAttachment();
    if (picked?.length) setPending(p => [...p, ...picked].slice(0, 10));
  }

  return (
    <View style={[styles.shell, { backgroundColor: t.background }, style]}>
      {/* HEADER */}
      <Header
        theme={t}
        title={screen.name === "tickets" ? "Tickets" : (config?.assistant_name ?? "Support")}
        subtitle={screen.name === "chat" ? "AI agent" : null}
        showBack={screen.name === "chat"}
        onBack={() => { unsubRef.current?.(); unsubRef.current = null; refreshConversations(); setScreen({ name: "conversations" }); }}
        onClose={onClose}
      />

      {screen.name === "loading" && (
        <View style={styles.center}><ActivityIndicator color={accent} /></View>
      )}

      {screen.name === "error" && (
        <View style={styles.center}>
          <Text style={{ color: "#991b1b", paddingHorizontal: 24, textAlign: "center" }}>{screen.message}</Text>
        </View>
      )}

      {screen.name === "conversations" && (
        <ScrollView style={{ flex: 1, backgroundColor: t.surface }} contentContainerStyle={{ padding: 12 }}>
          <TouchableOpacity
            onPress={() => openNewChat()}
            style={[styles.newConvoBtn, { backgroundColor: accent }]}
          >
            <Text style={{ color: t.primaryText, fontWeight: "600" }}>＋ Start a new conversation</Text>
            <Text style={{ color: t.primaryText, fontSize: 18 }}>›</Text>
          </TouchableOpacity>
          <Text style={{ color: t.mutedText, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginTop: 16, marginBottom: 6, paddingHorizontal: 4 }}>
            RECENT CONVERSATIONS
          </Text>
          {convosLoading && conversations.length === 0 ? (
            <View style={{ paddingVertical: 20 }}>
              <ActivityIndicator color={accent} />
            </View>
          ) : (
            <>
              {conversations.length === 0 && (
                <Text style={{ color: t.mutedText, paddingHorizontal: 4 }}>No previous conversations.</Text>
              )}
              {conversations.map(c => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => openExisting(c)}
                  style={[styles.convoRow, { backgroundColor: t.background, borderColor: t.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: t.text, fontWeight: "500" }}>
                      {c.preview?.content?.slice(0, 80) || c.summary?.slice(0, 80) || "Conversation"}
                    </Text>
                    <Text style={{ color: t.mutedText, fontSize: 11, marginTop: 2 }}>
                      {(c.status ?? "").replace("_", " ")} · {relativeTime(c.last_message_at)}
                    </Text>
                  </View>
                  <Text style={{ color: t.mutedText, fontSize: 18 }}>›</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {screen.name === "chat" && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          {tab === "messages" ? (
            <>
              {loadingChat ? (
                <View style={styles.center}><ActivityIndicator color={accent} /></View>
              ) : (
                <FlatList
                  ref={listRef}
                  data={messages.filter((m): m is Message => !!m && typeof m.id === "string")}
                  keyExtractor={m => m.id}
                  contentContainerStyle={{ padding: 12, gap: 10, backgroundColor: t.surface, flexGrow: 1 }}
                  style={{ backgroundColor: t.surface }}
                  renderItem={({ item }) => (
                    <Bubble
                      m={item}
                      theme={t}
                      accent={accent}
                      assistantName={config?.assistant_name ?? null}
                      onOpenAttachment={setPreview}
                    />
                  )}
                />
              )}

              {pending.length > 0 && (
                <View style={[styles.pendingRow, { borderTopColor: t.border, backgroundColor: t.background }]}>
                  {pending.map((a, i) => (
                    <View key={i} style={[styles.pendingThumb, { borderColor: t.border }]}>
                      {a.kind === "image"
                        ? <Image source={{ uri: a.uri }} style={{ width: 56, height: 56 }} />
                        : <View style={[styles.videoBadge, { backgroundColor: t.surface }]}><Text style={{ color: t.mutedText, fontSize: 11 }}>video</Text></View>}
                      <TouchableOpacity onPress={() => setPending(p => p.filter((_, j) => j !== i))} style={styles.removeBtn}>
                        <Text style={{ color: "#fff", fontSize: 12 }}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <View style={[styles.composer, { borderTopColor: t.border, backgroundColor: t.background }]}>
                {onPickAttachment && (
                  <TouchableOpacity onPress={handleAttach} style={styles.iconBtn}>
                    <Text style={{ color: t.mutedText, fontSize: 20 }}>📎</Text>
                  </TouchableOpacity>
                )}
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder="Enter message…"
                  placeholderTextColor={t.mutedText}
                  multiline
                  style={[styles.input, { color: t.text }]}
                />
                <TouchableOpacity
                  onPress={handleSend}
                  disabled={sending || (!text.trim() && pending.length === 0)}
                  style={[styles.sendBtn, { backgroundColor: accent, opacity: (sending || (!text.trim() && pending.length === 0)) ? 0.4 : 1 }]}
                >
                  <Text style={{ color: t.primaryText, fontWeight: "700" }}>↑</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <ScrollView style={{ flex: 1, backgroundColor: t.surface }} contentContainerStyle={{ padding: 12, gap: 8 }}>
              {tickets.length === 0 ? (
                <Text style={{ color: t.mutedText, textAlign: "center", marginTop: 24 }}>
                  You haven't opened any tickets yet.
                </Text>
              ) : tickets.map(tk => (
                <View key={tk.id} style={[styles.ticketRow, { backgroundColor: t.background, borderColor: t.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontWeight: "500" }} numberOfLines={1}>{tk.subject}</Text>
                    <Text style={{ color: t.mutedText, fontSize: 11, marginTop: 2, textTransform: "capitalize" }}>
                      {tk.status.replace("_", " ")}
                    </Text>
                  </View>
                  <Text style={{ color: t.mutedText, fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>{tk.ticket_number}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          {/* TAB BAR */}
          <View style={[styles.tabbar, { borderTopColor: t.border, backgroundColor: t.background }]}>
            <TabButton label="Messages" icon="💬" active={tab === "messages"} accent={accent} muted={t.mutedText} onPress={() => setTab("messages")} />
            <TabButton label="Tickets" icon="🎫" active={tab === "tickets"} accent={accent} muted={t.mutedText} onPress={() => setTab("tickets")} />
          </View>
        </KeyboardAvoidingView>
      )}
      <Modal
        visible={!!preview}
        transparent
        animationType="fade"
        onRequestClose={() => setPreview(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setPreview(null)}
          style={styles.previewBackdrop}
        >
          {preview ? (
            preview.kind === "video" && ExpoVideo ? (
              <ExpoVideo
                source={{ uri: mediaSrc(preview.url) }}
                style={styles.previewImage}
                useNativeControls
                resizeMode={ExpoVideoResizeMode}
              />
            ) : (
              <Image source={{ uri: mediaSrc(preview.url) }} style={styles.previewImage} resizeMode="contain" />
            )
          ) : null}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function Header({ theme: t, title, subtitle, showBack, onBack, onClose }: {
  theme: Required<SupportsMessengerTheme>;
  title: string; subtitle?: string | null;
  showBack?: boolean; onBack?: () => void; onClose?: () => void;
}) {
  return (
    <View style={[styles.header, { borderBottomColor: t.border, backgroundColor: t.background }]}>
      {showBack ? (
        <TouchableOpacity onPress={onBack} style={{ paddingRight: 8 }}>
          <Text style={{ color: t.mutedText, fontSize: 22 }}>‹</Text>
        </TouchableOpacity>
      ) : <View style={{ width: 24 }} />}
      <View style={{ flex: 1, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 }}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>{title}</Text>
        {subtitle && <Text style={{ color: t.mutedText, fontSize: 13 }}>· {subtitle}</Text>}
      </View>
      {onClose ? (
        <TouchableOpacity onPress={onClose}><Text style={{ color: t.mutedText, fontSize: 22 }}>×</Text></TouchableOpacity>
      ) : <View style={{ width: 24 }} />}
    </View>
  );
}

function TabButton({ label, icon, active, accent, muted, onPress }: {
  label: string; icon: string; active: boolean; accent: string; muted: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.tabBtn}>
      <Text style={{ fontSize: 16, color: active ? accent : muted }}>{icon}</Text>
      <Text style={{ fontSize: 11, fontWeight: "700", color: active ? accent : muted, marginTop: 2 }}>{label}</Text>
    </TouchableOpacity>
  );
}

function Bubble({ m, theme: t, accent, assistantName, onOpenAttachment }: {
  m: Message; theme: Required<SupportsMessengerTheme>; accent: string; assistantName: string | null; onOpenAttachment: (a: PreviewAttachment) => void;
}) {
  if (m.sender === "system") {
    return (
      <View style={{ alignItems: "center", paddingVertical: 6 }}>
        <Text style={{ color: t.mutedText, fontSize: 10, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>
          {(m.metadata as any)?.system_event_label || m.content || "Event"}
          {m.created_at ? ` · ${relativeTime(m.created_at)}` : ""}
        </Text>
      </View>
    );
  }
  const mine = m.sender === "customer";
  const text = mine ? (m.content ?? "") : (m.translated_content || m.content || "");
  // Backend may store attachments in two places:
  //   1) metadata.attachments[] — preferred, includes kind/mime
  //   2) attachment_url — legacy single-URL field; we infer the kind from extension
  let atts: Array<{ kind: "image" | "video"; url: string; mime?: string }> =
    (m.metadata?.attachments as any[] | undefined) ?? [];
  if (!atts.length && m.attachment_url) {
    const url = m.attachment_url;
    const lower = url.split("?")[0].toLowerCase();
    const isVideo = /\.(mp4|mov|webm|m4v|avi|mkv)$/.test(lower);
    atts = [{ kind: isVideo ? "video" : "image", url }];
  }
  const senderLabel = mine
    ? null
    : m.sender === "ai"
      ? `${m.sender_name ?? assistantName ?? "Assistant"} · AI agent`
      : m.sender === "agent"
        ? `${m.sender_name ?? "Teammate"} · Agent`
        : (m.sender_name ?? "");

  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%" }}>
      {text ? (
        <View
          style={[
            styles.bubble,
            mine
              ? { backgroundColor: accent, borderBottomRightRadius: 4 }
              : { backgroundColor: m.sender === "agent" ? "#eef6ff" : t.bubbleIncoming, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: t.border },
          ]}
        >
          <Text style={{ color: mine ? t.primaryText : t.bubbleIncomingText, fontSize: 14 }}>{text}</Text>
        </View>
      ) : null}
      {atts.map((a, i) => (
        <View key={i} style={{ marginTop: 6 }}>
          {a.kind === "image" ? (
            <TouchableOpacity activeOpacity={0.9} onPress={() => onOpenAttachment(a)}>
              <Image source={{ uri: mediaSrc(a.url) }} style={{ width: 220, height: 220, borderRadius: 12, backgroundColor: t.surface }} resizeMode="cover" />
            </TouchableOpacity>
          ) : (
            <VideoAttachment url={a.url} mime={a.mime} theme={t} onOpenAttachment={onOpenAttachment} />
          )}
        </View>
      ))}
      {senderLabel && (
        <Text style={{ fontSize: 11, color: t.mutedText, marginTop: 4, marginLeft: 4 }}>
          {senderLabel}{m.created_at ? ` · ${relativeTime(m.created_at)}` : ""}
        </Text>
      )}
      {mine && m.created_at && (
        <Text style={{ fontSize: 11, color: t.mutedText, alignSelf: "flex-end", marginTop: 4, marginRight: 4 }}>
          {relativeTime(m.created_at)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, borderRadius: 16, overflow: "hidden" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  newConvoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12 },
  convoRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 8 },
  ticketRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1 },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  videoBubble: { width: 220, padding: 16, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  videoCard: { width: 220, height: 220, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  videoThumb: { width: "100%", height: "100%" },
  videoThumbFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "#111827" },
  videoOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 10, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center" },
  videoOverlayText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 8, paddingVertical: 8, fontSize: 14 },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  pendingRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 8, borderTopWidth: 1 },
  pendingThumb: { width: 56, height: 56, borderRadius: 8, overflow: "hidden", borderWidth: 1, position: "relative" },
  videoBadge: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  removeBtn: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" },
  tabbar: { flexDirection: "row", borderTopWidth: 1 },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10 },
  videoBubbleSpacer: { height: 8 },
  previewBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: 16 },
  previewImage: { width: "100%", height: "100%" },
});
