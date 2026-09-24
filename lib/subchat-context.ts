"use client";

import type { UIMessage } from "ai";


export const SUBCHAT_TAG = "subchat-context" as const;

export function tagSubchatMessage(m: UIMessage): UIMessage {
  if ((m as any).metadata?.[SUBCHAT_TAG]) return m;
  return { ...m, metadata: { ...((m as any).metadata || {}), [SUBCHAT_TAG]: true } };
}

export function isSubchatMessage(m: UIMessage): boolean {
  return Boolean((m as any)?.metadata?.[SUBCHAT_TAG]);
}

interface Bridge {
  messages: UIMessage[];
  injectedIds: Set<string>;
}

export const subchatBridge: Bridge = {
  messages: [],
  injectedIds: new Set<string>(),
};

export function noteStoredSubchatIds(messages: UIMessage[] | null | undefined) {
  if (!messages) return;
  for (const m of messages) {
    if (m?.id && isSubchatMessage(m)) subchatBridge.injectedIds.add(m.id);
  }
}

export function pendingSubchatContext(mainMessages: UIMessage[]): UIMessage[] {
  const seen = new Set(mainMessages.map((m) => m.id));
  return subchatBridge.messages
    .filter((m) => !seen.has(m.id) && !subchatBridge.injectedIds.has(m.id))
    .map(tagSubchatMessage);
}

export function markInjected(messages: UIMessage[]) {
  for (const m of messages) {
    if (m?.id) subchatBridge.injectedIds.add(m.id);
  }
}

export function resetSubchatBridge() {
  subchatBridge.messages = [];
  subchatBridge.injectedIds.clear();
}
