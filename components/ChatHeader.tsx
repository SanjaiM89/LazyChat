"use client";

import * as React from "react";
import { PanelLeft, FileText, Monitor, Bot, FolderOpen, KeyRound, Settings2, X } from "lucide-react";
import { IconButton, Tooltip } from "@/components/ui";
import { useAppStore } from "@/lib/app-store";
import type { ChatController } from "@/lib/use-chat";
import { ModelPicker } from "@/components/ModelPicker";
import { ApiKeysDialog } from "@/components/ApiKeysDialog";
import { DisplaySettingsDialog } from "@/components/DisplaySettingsDialog";


function useTitle(chat: ChatController): string {
  const conversations = useAppStore((s) => s.conversations);
  const activeId = useAppStore((s) => s.activeConversationId);
  const active = conversations.find((c) => c.id === activeId);

  if (active) return active.title;
  const firstUser = chat.messages.find(
    (m) => m.role === "user" && !(m as any)?.metadata?.["subchat-context"],
  );
  if (!firstUser) return "New chat";
  const text = firstUser.parts
    .filter((p) => p.type === "text")
    .map((p: any) => p.text)
    .join(" ")
    .trim();
  return text.slice(0, 60) || "New chat";
}

export function ChatHeader({ chat }: { chat: ChatController }) {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setApiKeysOpen = useAppStore((s) => s.setApiKeysOpen);
  const setDisplayOpen = useAppStore((s) => s.setDisplayOpen);
  const providerKeyStatus = useAppStore((s) => s.providerKeyStatus);
  const panel = useAppStore((s) => s.panel);
  const setPanel = useAppStore((s) => s.setPanel);
  const title = useTitle(chat);
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const attached = useAppStore((s) =>
    activeConversationId ? s.conversationWorkspaces[activeConversationId] : undefined,
  );
  const setConversationWorkspace = useAppStore((s) => s.setConversationWorkspace);
  const openFiles = useAppStore((s) => s.setPanel);

  const opencodeReady = providerKeyStatus.opencode?.configured ?? false;

  const PANELS = [
    { id: "artifacts" as const, label: "Artifacts", icon: <FileText size={16} /> },
    { id: "sandbox" as const, label: "Chromium", icon: <Monitor size={16} /> },
    { id: "agents" as const, label: "Agents", icon: <Bot size={16} /> },
    ...(attached ? [{ id: "files" as const, label: "Workspace files", icon: <FolderOpen size={16} /> }] : []),
  ];

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
      <IconButton
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >
        <PanelLeft size={16} />
      </IconButton>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[14px] font-semibold text-fg">{title}</h1>
      </div>
      {attached && activeConversationId && (
        <Tooltip text={`Workspace folder: ${attached.path} — click to open files, × to detach`}>
          <button
            onClick={() => openFiles("files")}
            className="hidden items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-2.5 py-1 text-[11.5px] text-fg-secondary hover:border-accent/40 sm:inline-flex"
          >
            <FolderOpen size={13} className="text-accent" />
            <span className="max-w-40 truncate">{attached.name}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setConversationWorkspace(activeConversationId, null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  setConversationWorkspace(activeConversationId, null);
                }
              }}
              className="rounded-full p-0.5 hover:bg-bg-hover"
            >
              <X size={12} />
            </span>
          </button>
        </Tooltip>
      )}

      <div className="flex items-center gap-1">
        {PANELS.map((p) => (
          <Tooltip key={p.id} text={`${p.label} panel`}>
            <IconButton
              active={panel === p.id}
              onClick={() => setPanel(panel === p.id ? null : p.id)}
              className="hidden sm:inline-flex"
            >
              {p.icon}
            </IconButton>
          </Tooltip>
        ))}
        <div className="mx-1 h-5 w-px bg-border" />
        <Tooltip text="Display settings (font, size, width)">
          <IconButton onClick={() => setDisplayOpen(true)}>
            <Settings2 size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip text={opencodeReady ? "API keys (OpenCode Zen ready)" : "Add API keys (e.g. OpenCode Zen)"}>
          <IconButton onClick={() => setApiKeysOpen(true)} className="relative">
            <KeyRound size={16} />
            <span
              className={
                opencodeReady
                  ? "absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-success"
                  : "absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning"
              }
            />
          </IconButton>
        </Tooltip>
        <ModelPicker />
      </div>
      </header>
      <ApiKeysDialog />
      <DisplaySettingsDialog />
    </>
  );
}
