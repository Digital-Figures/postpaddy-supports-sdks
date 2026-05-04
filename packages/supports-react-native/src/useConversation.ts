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
    setState(s => {
      const idx = s.messages.findIndex(x => x.id === m.id);
      if (idx === -1) return { ...s, messages: [...s.messages, m] };
      const next = s.messages.slice();
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
          messages: hist.messages ?? [],
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

  const send = useCallback(async (text: string, attachments?: AttachmentInput[]) => {
    const tok = visitorTokenRef.current;
    if (!tok) throw new Error("Conversation not ready");
    setState(s => ({ ...s, sending: true, error: null }));
    try {
      const { message } = await client.sendMessage({ visitorToken: tok, text, attachments });
      upsertMessage(message);
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
