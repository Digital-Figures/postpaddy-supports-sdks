// Full multi-screen messenger UI — mirrors the Postpaddy web widget:
//   • Conversations list (returning visitors)
//   • Chat screen (with attachments, language switching, system events)
//   • Tickets tab
//
// Drop it under <SupportsProvider> and you're done. No props required —
// everything is driven by the visitor's contact_token in storage. Optional
// `identity` lets you pre-fill name/email/language without showing a form.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator,
  Image, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, type ViewStyle,
} from "react-native";
import { useSupports } from "./SupportsProvider";
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

function relativeTime(iso?: string | null) {
  if (!iso) return "just now";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
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
  const [tickets, setTickets] = useState<WidgetTicket[]>([]);

  // Active conversation
  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [pending, setPending] = useState<AttachmentInput[]>([]);
  const [text, setText] = useState("");
  const listRef = useRef<FlatList<Message>>(null);

  // Bootstrap: fetch brand config + load past conversations if any.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await client.bootstrap();
        if (cancelled) return;
        setConfig(cfg);
        const identified = await client.isIdentified();
        if (identified) {
          try {
            const list = await client.listConversations();
            if (cancelled) return;
            setConversations(list);
            setScreen({ name: "conversations" });
            return;
          } catch { /* fall through to fresh start */ }
        }
        // Anonymous / first-time visitor: jump straight into a new chat.
        await openNewChat(true);
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
      const list = await client.listConversations();
      setConversations(list);
    } catch { /* ignore */ }
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
      const idx = prev.findIndex(x => x.id === m.id);
      if (idx === -1) return [...prev, m];
      const next = prev.slice();
      next[idx] = { ...next[idx], ...m };
      return next;
    });
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
    try {
      await client.sendMessage({ visitorToken, text: body, attachments: atts.length ? atts : undefined });
      // realtime will deliver the message; if subscription is unavailable,
      // the optimistic flow above would need a local insert. We rely on
      // realtime + the server's response for ordering.
    } catch (e: any) {
      // surface as a system row
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
        showBack={screen.name === "chat" && conversations.length > 0}
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
                  renderItem={({ item }) => <Bubble m={item} theme={t} accent={accent} assistantName={config?.assistant_name ?? null} />}
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

function Bubble({ m, theme: t, accent, assistantName }: {
  m: Message; theme: Required<SupportsMessengerTheme>; accent: string; assistantName: string | null;
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
  const atts = m.metadata?.attachments ?? [];
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
            <Image source={{ uri: a.url }} style={{ width: 220, height: 220, borderRadius: 12, backgroundColor: t.surface }} resizeMode="cover" />
          ) : (
            <View style={[styles.videoBubble, { backgroundColor: t.surface, borderColor: t.border }]}>
              <Text style={{ color: t.mutedText }}>▶ Video attachment</Text>
            </View>
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
});
