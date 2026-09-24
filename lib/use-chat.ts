"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import type { FileUIPart, UIMessage } from "ai";
import { activeRunFor, useAppStore } from "@/lib/app-store";
import {
  BackgroundChatTransport,
  type AttachTarget,
} from "@/lib/chat-transport";
import {
  noteStoredSubchatIds,
  pendingSubchatContext,
  subchatBridge,
} from "@/lib/subchat-context";
import type { ChatRunSummary } from "@/lib/types";


const RUN_POLL_MS = 3000;

type ChatApi = {
  status: "ready" | "submitted" | "streaming" | "error";
  messages: UIMessage[];
  setMessages: (messages: UIMessage[] | ((m: UIMessage[]) => UIMessage[])) => void;
};

export function useChatController() {
  const settings = useAppStore((s) => s.settings);
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const setActiveConversation = useAppStore((s) => s.setActiveConversation);
  const loadConversations = useAppStore((s) => s.loadConversations);
  const loadArtifacts = useAppStore((s) => s.loadArtifacts);

  const cidRef = useRef<string | null>(activeConversationId);
  const settingsRef = useRef(settings);
  const loadConversationsRef = useRef(loadConversations);
  const loadArtifactsRef = useRef(loadArtifacts);
  const setActiveConversationRef = useRef(setActiveConversation);

  const attachRef = useRef<AttachTarget | null>(null);
  const attachingRef = useRef(false);
  const sawRunRef = useRef(false);
  const bootstrappedRef = useRef(false);
  const apiRef = useRef<{
    chat: ChatApi;
    attachToRun: (runId: string) => Promise<boolean>;
    syncConversation: (cid: string) => Promise<void>;
    reloadStored: (cid: string) => Promise<UIMessage[] | null>;
    refreshRuns: () => Promise<ChatRunSummary[]>;
  } | null>(null);

  useEffect(() => {
    cidRef.current = activeConversationId;
    settingsRef.current = settings;
    loadConversationsRef.current = loadConversations;
    loadArtifactsRef.current = loadArtifacts;
    setActiveConversationRef.current = setActiveConversation;
  });

  const ensureConversationId = useCallback((): string => {
    if (!cidRef.current) {
      cidRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `conv-${Date.now()}`;
      setActiveConversationRef.current(cidRef.current);
    }
    return cidRef.current;
  }, []);


  const fetchRuns = useCallback(async (): Promise<ChatRunSummary[]> => {
    try {
      const res = await fetch("/api/chat/runs", { cache: "no-store" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.runs) ? (data.runs as ChatRunSummary[]) : [];
    } catch {
      return [];
    }
  }, []);

  const refreshRuns = useCallback(async (): Promise<ChatRunSummary[]> => {
    const runs = await fetchRuns();
    useAppStore.getState().setRuns(runs);
    return runs;
  }, [fetchRuns]);

  const reloadStored = useCallback(
    async (cid: string): Promise<UIMessage[] | null> => {
      try {
        const res = await fetch(`/api/conversations/${cid}`, { cache: "no-store" });
        if (!res.ok) return null;
        const conv = await res.json();
        const messages = Array.isArray(conv.messages) ? (conv.messages as UIMessage[]) : [];
        noteStoredSubchatIds(messages);
        return messages;
      } catch {
        return null;
      }
    },
    [],
  );

  const transport = useMemo(
    () =>
      new BackgroundChatTransport({
        getAttachTarget: () => attachRef.current,
        onRunStarted: (runId) => {
          attachRef.current = { runId };
          void refreshRuns();
        },
        getExtraContext: () => {
          if (!useAppStore.getState().subchatOpen) return [];
          if (!subchatBridge.messages.length) return [];
          return pendingSubchatContext(apiRef.current?.chat.messages ?? []);
        },
      }),
    [refreshRuns],
  );

  const chat = useChat({
    transport,
    onFinish: async () => {
      try {
        const cid = cidRef.current;
        await loadConversationsRef.current();
        if (cid) await loadArtifactsRef.current(cid);
        await refreshRuns();
      } catch {
      }
    },
    onError: (e) => {
      console.error("[chat]", e?.message || e);
    },
  });

  const attachToRun = useCallback(
    async (runId: string): Promise<boolean> => {
      if (attachingRef.current) return false;
      attachingRef.current = true;
      try {
        const res = await fetch(`/api/chat/runs/${runId}`, { cache: "no-store" });
        if (!res.ok) {
          if (attachRef.current?.runId === runId) attachRef.current = null;
          return false;
        }
        const snap = await res.json();
        const messages: UIMessage[] = Array.isArray(snap?.messages)
          ? snap.messages
          : [];
        const run = snap?.run as ChatRunSummary | undefined;
        noteStoredSubchatIds(messages);

        attachRef.current = { runId };
        if (run?.conversationId) {
          cidRef.current = run.conversationId;
          setActiveConversationRef.current(run.conversationId);
        }
        chat.setMessages(messages);
        chat.clearError();
        sawRunRef.current = run?.status === "running";
        if (run?.status === "running" && run.replayable !== false) {
          await chat.resumeStream();
        }
        return true;
      } catch {
        return false;
      } finally {
        attachingRef.current = false;
      }
    },
    [chat],
  );

  const syncConversation = useCallback(
    async (cid: string) => {
      const busy = chat.status === "submitted" || chat.status === "streaming";
      if (busy && attachRef.current?.runId) return;

      const runs = await fetchRuns();
      useAppStore.getState().setRuns(runs);
      const live = runs.find(
        (r) => r.conversationId === cid && r.status === "running",
      );
      if (live) {
        await attachToRun(live.id);
        return;
      }
      attachRef.current = null;
      const messages = await reloadStored(cid);
      if (messages) {
        chat.setMessages(messages);
        chat.clearError();
      }
      void loadArtifactsRef.current(cid);
    },
    [attachToRun, chat, fetchRuns, reloadStored],
  );


  const detach = useCallback(async () => {
    attachRef.current = null;
    try {
      await chat.stop();
    } catch {
    }
  }, [chat]);

  const startNew = useCallback(() => {
    void detach();
    chat.setMessages([]);
    chat.clearError();
    cidRef.current = null;
    setActiveConversationRef.current(null);
  }, [chat, detach]);

  const openConversation = useCallback(
    async (id: string) => {
      if (chat.status === "submitted" || chat.status === "streaming") {
        await detach();
      }
      cidRef.current = id;
      setActiveConversationRef.current(id);
      attachRef.current = null;
      await syncConversation(id);
    },
    [chat.status, detach, syncConversation],
  );

  const send = useCallback(
    (text: string, files?: FileUIPart[]) => {
      const cid = ensureConversationId();
      const live = activeRunFor(useAppStore.getState().runs, cid);
      if (live) {
        void attachToRun(live.id);
        return;
      }
      const payload: { text: string; files?: FileUIPart[] } = { text };
      if (files?.length) payload.files = files;
      void chat.sendMessage(payload, {
        body: { settings: settingsRef.current, conversationId: cid },
      });
    },
    [attachToRun, chat, ensureConversationId],
  );

  const regenerate = useCallback(() => {
    const cid = ensureConversationId();
    const live = activeRunFor(useAppStore.getState().runs, cid);
    if (live) {
      void attachToRun(live.id);
      return;
    }
    void chat.regenerate({
      body: { settings: settingsRef.current, conversationId: cid },
    });
  }, [attachToRun, chat, ensureConversationId]);

  const stop = useCallback(() => {
    const runId = attachRef.current?.runId;
    void detach();
    if (runId) {
      void fetch(`/api/chat/runs/${runId}`, { method: "DELETE" }).catch(() => {});
    }
    setTimeout(() => {
      void refreshRuns();
      void loadConversationsRef.current();
      const cid = cidRef.current;
      if (cid) void loadArtifactsRef.current(cid);
    }, 700);
  }, [detach, refreshRuns]);

  const stopRun = useCallback(
    async (runId: string) => {
      await fetch(`/api/chat/runs/${runId}`, { method: "DELETE" }).catch(() => {});
      await refreshRuns();
      await loadConversationsRef.current();
      const cid = cidRef.current;
      if (!cid) return;
      void loadArtifactsRef.current(cid);
      if (chat.status === "submitted" || chat.status === "streaming") return;
      const messages = await reloadStored(cid);
      if (messages) chat.setMessages(messages);
    },
    [chat, refreshRuns, reloadStored],
  );

  const showRun = useCallback(
    async (runId: string) => {
      await attachToRun(runId);
    },
    [attachToRun],
  );


  useEffect(() => {
    apiRef.current = {
      chat,
      attachToRun,
      syncConversation,
      reloadStored,
      refreshRuns,
    };
  });

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    const cid = cidRef.current;
    const api = apiRef.current;
    if (!api) return;
    if (cid) void api.syncConversation(cid);
    else void api.refreshRuns();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const api = apiRef.current;
        if (!api) return;
        const runs = await api.refreshRuns();
        if (cancelled) return;

        const cid = cidRef.current;
        const live = cid
          ? runs.find(
              (r) => r.conversationId === cid && r.status === "running",
            ) ?? null
          : null;
        const attachedId = attachRef.current?.runId ?? null;
        const busy =
          api.chat.status === "submitted" || api.chat.status === "streaming";

        if (live && live.id !== attachedId && !busy && !attachingRef.current) {
          await api.attachToRun(live.id);
        } else if (!live && attachedId) {
          attachRef.current = null;
        }

        if (live) {
          sawRunRef.current = true;
        } else if (sawRunRef.current) {
          sawRunRef.current = false;
          void loadConversationsRef.current();
          if (cid) {
            void loadArtifactsRef.current(cid);
            if (!busy) {
              const messages = await api.reloadStored(cid);
              const localLast = api.chat.messages[api.chat.messages.length - 1];
              const serverLast = messages?.[messages.length - 1];
              if (messages && !cancelled && (!localLast || serverLast?.id === localLast.id)) {
                api.chat.setMessages(messages);
              }
            }
          }
        }
      } catch {
      } finally {
        if (!cancelled) timer = setTimeout(tick, RUN_POLL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return {
    ...chat,
    settings,
    send,
    startNew,
    openConversation,
    regenerate,
    stop,
    activeConversationId,
    stopRun,
    showRun,
    attachToRun,
    refreshRuns,
  };
}

export type ChatController = ReturnType<typeof useChatController>;
