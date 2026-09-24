"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useAppStore } from "@/lib/app-store";
import {
  BackgroundChatTransport,
  type AttachTarget,
} from "@/lib/chat-transport";
import { resetSubchatBridge, subchatBridge } from "@/lib/subchat-context";
import type { ChatController } from "@/lib/use-chat";


export function useSubchatController(mainChat: ChatController) {
  const settings = useAppStore((s) => s.settings);

  const settingsRef = useRef(settings);
  const mainRef = useRef(mainChat);
  const attachRef = useRef<AttachTarget | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
    mainRef.current = mainChat;
  });

  const transport = useMemo(
    () =>
      new BackgroundChatTransport({
        getAttachTarget: () => attachRef.current,
        onRunStarted: (id) => {
          attachRef.current = { runId: id };
          setRunId(id);
        },
        mapOutgoingMessages: (messages) => {
          const main = mainRef.current?.messages ?? [];
          if (!main.length) return messages;
          const seen = new Set(messages.map((m) => m.id));
          const prefix = main.filter((m) => !seen.has(m.id));
          return prefix.length ? [...prefix, ...messages] : messages;
        },
      }),
    [],
  );

  const chat = useChat({
    transport,
    onFinish: () => setRunId(null),
    onError: (e) => {
      console.error("[subchat]", e?.message || e);
      setRunId(null);
    },
  });

  useEffect(() => {
    subchatBridge.messages = chat.messages;
  }, [chat.messages]);

  const send = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value) return;
      if (chat.status === "submitted" || chat.status === "streaming") return;
      attachRef.current = null;
      void chat.sendMessage(
        { text: value },
        { body: { settings: settingsRef.current } },
      );
    },
    [chat],
  );

  const stop = async () => {
    const id = attachRef.current?.runId ?? runId;
    attachRef.current = null;
    try {
      await chat.stop();
    } catch {
    }
    if (id) {
      void fetch(`/api/chat/runs/${id}`, { method: "DELETE" }).catch(() => {});
    }
    setRunId(null);
  };

  const clear = () => {
    attachRef.current = null;
    setRunId(null);
    chat.setMessages([]);
    chat.clearError();
    resetSubchatBridge();
  };

  const busy = chat.status === "submitted" || chat.status === "streaming";

  return {
    messages: chat.messages as UIMessage[],
    status: chat.status,
    error: chat.error,
    clearError: chat.clearError,
    setMessages: chat.setMessages,
    busy,
    send,
    stop,
    clear,
  };
}

export type SubchatController = ReturnType<typeof useSubchatController>;
