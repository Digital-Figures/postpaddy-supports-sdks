import { useCallback, useEffect, useRef, useState } from "react";
import { useSupports } from "./SupportsProvider";
import type { AttachmentInput, Conversation, Message, StartConversationInput } from "./types";

export type UseConversationState = {
  loading: boolean;
  sending: boolean;
  error: string | null;
  conversation: Conversation | null;
  messages: Message[];
};

/**
 * Drives a single chat session. Handles start/resume, history load, send,
 * and realtime updates. Pair with <SupportsProvider>.
 */
export function useConversation(initial?: { conversationId?: string; identity?: StartConversationInput }) {
  const client = useSupports();
  const [state, setState] = useState<UseConversationState>({
    loading: true, sending: false, error: null, conversation: null, messages: [],
  });
  const visitorTokenRef = useRef<string | null>(null);

  const upsertMessage = useCallback((m: Message) => {
    if (!m || typeof m.id !== "string") return;
    setState(s => {
      // Reconcile real DB row with an existing local placeholder of the same
      // sender + content (added by send() for instant UI feedback).
      const isReal = !m.id.startsWith("local_");
      let arr = s.messages;
      if (isReal) {
        const ph = arr.findIndex(x =>
          x.id.startsWith("local_") &&
          x.sender === m.sender &&
          (x.content ?? "") === (m.content ?? "")
        );
        if (ph !== -1) {
          arr = arr.slice();
          arr[ph] = { ...arr[ph], ...m };
          return { ...s, messages: arr };
        }
      }
      const idx = arr.findIndex(x => x.id === m.id);
      if (idx === -1) return { ...s, messages: [...arr, m] };
      const next = arr.slice();
      next[idx] = { ...next[idx], ...m };
      return { ...s, messages: next };
    });
  }, []);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        setState(s => ({ ...s, loading: true, error: null }));
        const opened = initial?.conversationId
          ? await client.openConversation(initial.conversationId)
          : await client.startConversation(initial?.identity);
        if (cancelled) return;
        visitorTokenRef.current = opened.visitorToken;
        const hist = await client.loadHistory(opened.visitorToken);
        if (cancelled) return;
        setState({
          loading: false, sending: false, error: null,
          conversation: { ...opened.conversation, id: hist.conversation_id },
          messages: (hist.messages ?? []).filter((m): m is Message => !!m && typeof m.id === "string"),
        });
        unsub = client.subscribeMessages(hist.conversation_id, (m) => upsertMessage(m));
      } catch (e: any) {
        if (!cancelled) setState(s => ({ ...s, loading: false, error: e?.message ?? String(e) }));
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [initial?.conversationId]); // eslint-disable-line

  // Polling fallback: realtime can be silent if @supabase/supabase-js isn't
  // installed in the host app, or if RLS / publication blocks the subscription.
  // Without this, agent replies from the dashboard would never arrive.
  useEffect(() => {
    const tok = visitorTokenRef.current;
    if (!tok) return;
    const id = setInterval(async () => {
      const t = visitorTokenRef.current;
      if (!t) return;
      try {
        const hist = await client.loadHistory(t);
        hist.messages.forEach(upsertMessage);
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(id);
  }, [client, upsertMessage, state.conversation?.id]);

  const send = useCallback(async (text: string, attachments?: AttachmentInput[]) => {
    const tok = visitorTokenRef.current;
    if (!tok) throw new Error("Conversation not ready");
    setState(s => ({ ...s, sending: true, error: null }));

    // Optimistic visitor row — instant feedback. Realtime will replace it
    // when the persisted row arrives (matched in upsertMessage()).
    const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    upsertMessage({
      id: localId,
      conversation_id: "",
      sender: "customer",
      sender_name: null,
      content: text,
      created_at: new Date().toISOString(),
      metadata: attachments?.length
        ? { attachments: attachments.map(a => ({ kind: a.kind, url: a.uri, mime: a.mime })) }
        : undefined,
    } as Message);

    try {
      const res = await client.sendMessage({ visitorToken: tok, text, attachments });
      if (res?.reply) {
        upsertMessage({
          id: `local_ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          conversation_id: "",
          sender: "ai",
          sender_name: null,
          content: res.reply,
          created_at: new Date().toISOString(),
        } as Message);
      }
    } catch (e: any) {
      setState(s => ({ ...s, error: e?.message ?? String(e) }));
      throw e;
    } finally {
      setState(s => ({ ...s, sending: false }));
    }
  }, [client, upsertMessage]);

  const setLanguage = useCallback(async (lang: string) => {
    const tok = visitorTokenRef.current;
    if (!tok) return;
    await client.setLanguage(tok, lang);
  }, [client]);

  return { ...state, send, setLanguage };
}
