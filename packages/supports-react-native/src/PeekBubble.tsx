// Floating "new message" peek bubble + launcher unread badge.
// Designed to sit above your launcher button, like Intercom's preview pill.
//
// UX rules (shared across all Postpaddy SDKs):
//   • Latest agent/AI message text only — bursts replace, never stack.
//   • Auto-dismiss after 6s; the badge persists until the chat opens.
//   • Tap → onOpen() (host opens the chat panel and unread is cleared).
//   • Plays sound/haptic per SupportsProvider notification settings.
//   • First incoming message with sound/haptic = "ask" shows a one-time prompt.
import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from "react-native";
import { useSupportsNotifications } from "./SupportsProvider";
import { playNotificationSound, triggerNotificationHaptic } from "./notify";
import type { Message } from "./types";

const PROMPT_KEY = "postpaddy:supports:notify_prompt_v1";
let storage: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> } | null = null;
function getStorage() {
  if (storage) return storage;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@react-native-async-storage/async-storage");
    const s = mod?.default ?? mod;
    if (s?.getItem && s?.setItem) { storage = s; return storage; }
  } catch { /* optional */ }
  return null;
}

type Choice = { sound: boolean; haptic: boolean };
async function loadChoice(): Promise<Choice | null> {
  const s = getStorage();
  if (!s) return null;
  const raw = await s.getItem(PROMPT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function saveChoice(c: Choice): Promise<void> {
  const s = getStorage();
  if (!s) return;
  await s.setItem(PROMPT_KEY, JSON.stringify(c));
}

export type PeekBubbleProps = {
  message: Message | null;
  unreadCount: number;
  brandColor?: string;
  onOpen: () => void;
  /** Auto-dismiss after this many ms (default 6000). */
  autoDismissMs?: number;
};

export function PeekBubble({
  message, unreadCount, brandColor = "#149DFF", onOpen, autoDismissMs = 6000,
}: PeekBubbleProps) {
  const notif = useSupportsNotifications();
  const [visible, setVisible] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [resolvedSound, setResolvedSound] = useState<boolean | null>(null);
  const [resolvedHaptic, setResolvedHaptic] = useState<boolean | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const lastIdRef = useRef<string | null>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve sound/haptic preference (brand default → stored choice → ask).
  useEffect(() => {
    (async () => {
      const stored = await loadChoice();
      if (stored) { setResolvedSound(stored.sound); setResolvedHaptic(stored.haptic); return; }
      if (notif.sound !== "ask") setResolvedSound(notif.sound === "on");
      if (notif.haptic !== "ask") setResolvedHaptic(notif.haptic === "on");
    })();
  }, [notif.sound, notif.haptic]);

  useEffect(() => {
    if (!message || !notif.peek) return;
    if (lastIdRef.current === message.id) return;
    lastIdRef.current = message.id;

    // First time + still "ask" for either → show prompt instead of bubble.
    if ((notif.sound === "ask" && resolvedSound === null) ||
        (notif.haptic === "ask" && resolvedHaptic === null)) {
      setShowPrompt(true);
      return;
    }

    // Play sound/haptic if allowed.
    if (resolvedSound) void playNotificationSound();
    if (resolvedHaptic) void triggerNotificationHaptic();

    // Show / refresh the bubble.
    setVisible(true);
    Animated.timing(opacity, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    if (dismissRef.current) clearTimeout(dismissRef.current);
    dismissRef.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }).start(() => setVisible(false));
    }, autoDismissMs);

    return () => { if (dismissRef.current) clearTimeout(dismissRef.current); };
  }, [message?.id, notif.peek, notif.sound, notif.haptic, resolvedSound, resolvedHaptic]); // eslint-disable-line

  async function answerPrompt(allow: boolean) {
    const choice: Choice = { sound: allow, haptic: allow };
    await saveChoice(choice);
    setResolvedSound(choice.sound);
    setResolvedHaptic(choice.haptic);
    setShowPrompt(false);
    // Surface the bubble that triggered the prompt now that we have a choice.
    setVisible(true);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    if (dismissRef.current) clearTimeout(dismissRef.current);
    dismissRef.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }).start(() => setVisible(false));
    }, autoDismissMs);
    if (allow) { void playNotificationSound(); void triggerNotificationHaptic(); }
  }

  if (showPrompt) {
    return (
      <View style={styles.promptCard}>
        <Text style={styles.promptText}>Get a sound + buzz when {message?.sender_name ?? "support"} replies?</Text>
        <View style={styles.promptRow}>
          <TouchableOpacity onPress={() => answerPrompt(false)} style={[styles.promptBtn, { backgroundColor: "#f1f5f9" }]}>
            <Text style={[styles.promptBtnText, { color: "#475569" }]}>Not now</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => answerPrompt(true)} style={[styles.promptBtn, { backgroundColor: brandColor }]}>
            <Text style={[styles.promptBtnText, { color: "#fff" }]}>Allow</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!visible || !message) return null;
  const preview = previewText(message);
  return (
    <Animated.View style={[styles.bubbleWrap, { opacity }]}>
      <TouchableOpacity activeOpacity={0.85} onPress={onOpen} style={styles.bubble}>
        {message.sender_name && (
          <Text style={styles.sender} numberOfLines={1}>
            Reply from {message.sender_name}{unreadCount > 1 ? `  ·  +${unreadCount - 1} more` : ""}
          </Text>
        )}
        <Text style={styles.body} numberOfLines={2}>{preview}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

export function LauncherBadge({ count, color = "#ef4444" }: { count: number; color?: string }) {
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: color }]} pointerEvents="none">
      <Text style={styles.badgeText}>{count > 9 ? "9+" : String(count)}</Text>
    </View>
  );
}

function previewText(m: Message): string {
  const txt = (m.translated_content || m.content || "").trim();
  if (txt) return txt.length > 80 ? `${txt.slice(0, 80)}…` : txt;
  const atts = m.metadata?.attachments ?? [];
  if (atts.some(a => a.kind === "image")) return "📷 Photo";
  if (atts.some(a => a.kind === "video")) return "🎥 Video";
  if (m.attachment_url) return "📎 Attachment";
  return "New message";
}

const styles = StyleSheet.create({
  bubbleWrap: { position: "absolute", right: 12, bottom: 88, maxWidth: 320 },
  bubble: {
    backgroundColor: "#fff", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  sender: { fontSize: 12, fontWeight: "600", color: "#0f172a", marginBottom: 2 },
  body: { fontSize: 13, color: "#334155" },
  badge: {
    position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 5, alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  promptCard: {
    position: "absolute", right: 12, bottom: 88, maxWidth: 320, backgroundColor: "#fff",
    borderRadius: 16, padding: 14, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  promptText: { fontSize: 13, color: "#0f172a", marginBottom: 10 },
  promptRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  promptBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  promptBtnText: { fontSize: 13, fontWeight: "600" },
});
