// Tracks unread state for a single conversation while the chat panel is closed.
// - Subscribes to realtime inserts (when @supabase/supabase-js is available).
// - Polls history every 15s as a fallback.
// - Persists last-seen locally so the badge is correct after app restart.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSupports } from "./SupportsProvider";
import type { Message } from "./types";

const LAST_SEEN_KEY = (cid: string) => `postpaddy:supports:last_seen:${cid}`;

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

export type UnreadState = {
  unreadCount: number;
  lastIncoming: Message | null;
  lastSeenAt: string | null;
  /** Mark seen locally + on the backend. */
  markSeen: (visitorToken?: string) => Promise<void>;
};

export function useUnread(args: {
  conversationId: string | null;
  visitorToken: string | null;
  /** When true (chat open), unread is forced to 0 and any new message is auto-marked seen. */
  isOpen: boolean;
}): UnreadState {
  const { conversationId, visitorToken, isOpen } = args;
  const client = useSupports();
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [lastIncoming, setLastIncoming] = useState<Message | null>(null);
  const [messagesAfterSeen, setMessagesAfterSeen] = useState<Message[]>([]);
  const seenInitRef = useRef(false);

  // Hydrate last-seen from local storage first, then from server.
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      const s = getStorage();
      const local = s ? await s.getItem(LAST_SEEN_KEY(conversationId)) : null;
      if (!cancelled && local) setLastSeenAt(local);
      if (visitorToken) {
        try {
          const hist = await client.loadHistory(visitorToken);
          if (cancelled) return;
          if (hist.visitor_last_seen_at) {
            setLastSeenAt(hist.visitor_last_seen_at);
            if (s) await s.setItem(LAST_SEEN_KEY(conversationId), hist.visitor_last_seen_at);
          }
          // Seed unread from history.
          const since = hist.visitor_last_seen_at ?? local ?? null;
          const incoming = hist.messages.filter(m => isIncoming(m) && (!since || m.created_at > since));
          setMessagesAfterSeen(incoming);
          if (incoming.length) setLastIncoming(incoming[incoming.length - 1]);
          seenInitRef.current = true;
        } catch { /* swallow */ }
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId, visitorToken, client]);

  // Realtime + polling fallback.
  useEffect(() => {
    if (!conversationId || !visitorToken) return;
    let cancelled = false;
    let unsub: (() => void) | null = null;
    try {
      unsub = client.subscribeMessages(conversationId, (m, ev) => {
        if (cancelled || ev !== "INSERT") return;
        if (!isIncoming(m)) return;
        setMessagesAfterSeen(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
        setLastIncoming(m);
      });
    } catch { /* realtime optional */ }

    const poll = setInterval(async () => {
      if (cancelled) return;
      try {
        const hist = await client.loadHistory(visitorToken);
        const since = lastSeenAt;
        const incoming = hist.messages.filter(m => isIncoming(m) && (!since || m.created_at > since));
        setMessagesAfterSeen(incoming);
        if (incoming.length) setLastIncoming(incoming[incoming.length - 1]);
      } catch { /* ignore */ }
    }, 15_000);

    return () => {
      cancelled = true;
      if (unsub) unsub();
      clearInterval(poll);
    };
  }, [conversationId, visitorToken, client, lastSeenAt]);

  const markSeen = useCallback(async (tok?: string) => {
    if (!conversationId) return;
    const now = new Date().toISOString();
    setLastSeenAt(now);
    setMessagesAfterSeen([]);
    const s = getStorage();
    if (s) await s.setItem(LAST_SEEN_KEY(conversationId), now);
    const t = tok ?? visitorToken;
    if (t) {
      try { await client.markSeen(t); } catch { /* best-effort */ }
    }
  }, [conversationId, visitorToken, client]);

  // Auto-mark seen when chat is open.
  useEffect(() => {
    if (isOpen && messagesAfterSeen.length > 0) void markSeen();
  }, [isOpen, messagesAfterSeen.length, markSeen]);

  return {
    unreadCount: isOpen ? 0 : messagesAfterSeen.length,
    lastIncoming: isOpen ? null : lastIncoming,
    lastSeenAt,
    markSeen,
  };
}

function isIncoming(m: Message): boolean {
  return m.sender === "agent" || m.sender === "ai";
}
