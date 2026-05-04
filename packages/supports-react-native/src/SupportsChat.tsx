// Drop-in chat screen. Themable via the `theme` prop. Renders text + image
// + video bubbles, a composer with attachment picker hook, and the typing
// indicator. Heavy work (uploads, realtime, history) is handled by the
// underlying client/hooks so this stays presentational.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator,
  Image, StyleSheet, KeyboardAvoidingView, Platform, Modal, Linking, type ViewStyle,
} from "react-native";
import { SUPPORTS_SUPABASE_URL } from "./config";
import { useConversation } from "./useConversation";
import type { AttachmentInput, Message, StartConversationInput } from "./types";

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

export type SupportsChatTheme = {
  background?: string;
  surface?: string;
  border?: string;
  text?: string;
  mutedText?: string;
  primary?: string;          // agent / outgoing bubble
  primaryText?: string;
  bubbleIncoming?: string;
  bubbleIncomingText?: string;
};

const defaultTheme: Required<SupportsChatTheme> = {
  background: "#ffffff",
  surface: "#f5f6f8",
  border: "#e6e8ec",
  text: "#0f172a",
  mutedText: "#64748b",
  primary: "#1f2bff",
  primaryText: "#ffffff",
  bubbleIncoming: "#f1f5f9",
  bubbleIncomingText: "#0f172a",
};

function mediaSrc(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  return `${SUPPORTS_SUPABASE_URL}/functions/v1/chat-media?url=${encodeURIComponent(url)}`;
}

function VideoAttachment({
  url,
  theme,
}: {
  url: string;
  theme: Required<SupportsChatTheme>;
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
      <View style={{ width: 220, height: 220, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" }}>
        <ExpoVideo
          source={{ uri: src }}
          style={{ width: "100%", height: "100%" }}
          useNativeControls
          resizeMode={ExpoVideoResizeMode}
        />
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(src).catch(() => {})}
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

export type SupportsChatProps = {
  /** Resume a specific conversation. Otherwise a new one is started. */
  conversationId?: string;
  /** Identity passed to startConversation when no contact_token exists yet. */
  identity?: StartConversationInput;
  /** Hook the host app provides to pick image/video attachments. */
  onPickAttachment?: () => Promise<AttachmentInput[] | null>;
  theme?: SupportsChatTheme;
  style?: ViewStyle;
  placeholder?: string;
};

export function SupportsChat({
  conversationId, identity, onPickAttachment, theme, style, placeholder,
}: SupportsChatProps) {
  const t = { ...defaultTheme, ...(theme ?? {}) };
  const initial = useMemo(() => ({ conversationId, identity }), [conversationId]); // eslint-disable-line
  const { loading, sending, error, messages, send } = useConversation(initial);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<AttachmentInput[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    if (messages.length) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length]);

  const canSend = !sending && (text.trim().length > 0 || pending.length > 0);

  async function handleSend() {
    if (!canSend) return;
    const body = text;
    const atts = pending;
    setText(""); setPending([]);
    try { await send(body, atts.length ? atts : undefined); } catch { /* surfaced via state.error */ }
  }

  async function handleAttach() {
    if (!onPickAttachment) return;
    const picked = await onPickAttachment();
    if (picked?.length) setPending(p => [...p, ...picked].slice(0, 10));
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[{ flex: 1, backgroundColor: t.background }, style]}
    >
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={t.primary} /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages.filter((m): m is Message => !!m && typeof m.id === "string")}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 12, gap: 8 }}
          renderItem={({ item }) => <Bubble m={item} theme={t} onOpenImage={setPreviewUrl} />}
        />
      )}

      {error && (
        <View style={[styles.errorBar, { backgroundColor: "#fee2e2" }]}>
          <Text style={{ color: "#991b1b", fontSize: 12 }}>{error}</Text>
        </View>
      )}

      {pending.length > 0 && (
        <View style={[styles.pendingRow, { borderTopColor: t.border }]}>
          {pending.map((a, i) => (
            <View key={i} style={[styles.pendingThumb, { borderColor: t.border }]}>
              {a.kind === "image"
                ? <Image source={{ uri: a.uri }} style={{ width: 56, height: 56 }} />
                : <View style={[styles.videoBadge, { backgroundColor: t.surface }]}><Text style={{ color: t.mutedText, fontSize: 11 }}>video</Text></View>}
              <TouchableOpacity
                onPress={() => setPending(p => p.filter((_, j) => j !== i))}
                style={styles.removeBtn}
              >
                <Text style={{ color: "#fff", fontSize: 12 }}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={[styles.composer, { borderTopColor: t.border, backgroundColor: t.background }]}>
        {onPickAttachment && (
          <TouchableOpacity onPress={handleAttach} style={[styles.iconBtn, { borderColor: t.border }]}>
            <Text style={{ color: t.mutedText, fontSize: 18 }}>＋</Text>
          </TouchableOpacity>
        )}
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder ?? "Type a message…"}
          placeholderTextColor={t.mutedText}
          multiline
          style={[styles.input, { color: t.text, backgroundColor: t.surface, borderColor: t.border }]}
        />
        <TouchableOpacity
          disabled={!canSend}
          onPress={handleSend}
          style={[styles.sendBtn, { backgroundColor: canSend ? t.primary : t.border }]}
        >
          <Text style={{ color: t.primaryText, fontWeight: "600" }}>{sending ? "…" : "Send"}</Text>
        </TouchableOpacity>
      </View>
      <Modal
        visible={!!previewUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewUrl(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setPreviewUrl(null)}
          style={styles.previewBackdrop}
        >
          {previewUrl ? (
            <Image source={{ uri: previewUrl }} style={styles.previewImage} resizeMode="contain" />
          ) : null}
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Bubble({
  m,
  theme,
  onOpenImage,
}: {
  m: Message;
  theme: Required<SupportsChatTheme>;
  onOpenImage: (url: string) => void;
}) {
  const mine = m.sender === "customer";
  const bg = mine ? theme.primary : theme.bubbleIncoming;
  const fg = mine ? theme.primaryText : theme.bubbleIncomingText;
  const align: ViewStyle = { alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%" };
  // Backend stores attachments either in metadata.attachments[] or, for legacy
  // single-file messages, in m.attachment_url. Surface both.
  let atts: Array<{ kind: "image" | "video"; url: string; mime?: string }> =
    (m.metadata?.attachments as any[] | undefined) ?? [];
  if (!atts.length && m.attachment_url) {
    const lower = m.attachment_url.split("?")[0].toLowerCase();
    const isVideo = /\.(mp4|mov|webm|m4v|avi|mkv)$/.test(lower);
    atts = [{ kind: isVideo ? "video" : "image", url: m.attachment_url }];
  }

  return (
    <View style={align}>
      {!mine && m.sender_name && (
        <Text style={{ fontSize: 11, color: theme.mutedText, marginBottom: 2, marginLeft: 4 }}>
          {m.sender_name}{m.sender === "ai" ? " · AI" : ""}
        </Text>
      )}
      {(m.content || m.translated_content) && (
        <View style={[styles.bubble, { backgroundColor: bg }]}>
          <Text style={{ color: fg, fontSize: 14 }}>{m.translated_content || m.content}</Text>
        </View>
      )}
      {atts.map((a, i) => (
        <View key={i} style={{ marginTop: 4 }}>
          {a.kind === "image" ? (
            <TouchableOpacity activeOpacity={0.9} onPress={() => onOpenImage(mediaSrc(a.url))}>
              <Image
                source={{ uri: mediaSrc(a.url) }}
                style={{ width: 220, height: 220, borderRadius: 12, backgroundColor: theme.surface }}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ) : (
            <VideoAttachment url={a.url} theme={theme} />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  videoBubble: { width: 220, padding: 16, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  videoCard: { width: 220, height: 220, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  videoThumb: { width: "100%", height: "100%" },
  videoThumbFallback: { alignItems: "center", justifyContent: "center", backgroundColor: "#111827" },
  videoOverlay: { position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 10, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center" },
  videoOverlayText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 8, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  sendBtn: { paddingHorizontal: 16, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  pendingRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 8, borderTopWidth: 1 },
  pendingThumb: { width: 56, height: 56, borderRadius: 8, overflow: "hidden", borderWidth: 1, position: "relative" },
  videoBadge: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  removeBtn: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" },
  errorBar: { padding: 8 },
  previewBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: 16 },
  previewImage: { width: "100%", height: "100%" },
});
