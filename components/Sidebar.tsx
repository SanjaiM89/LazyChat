"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  MessageSquare,
  MessageCircle,
  Brain,
  Briefcase,
  BookOpen,
  Plug,
  PanelLeft,
  Globe,
} from "lucide-react";
import { cn, Tooltip } from "@/components/ui";
import { AttachWorkspaceDialog } from "@/components/workspace/AttachWorkspaceDialog";
import {
  useAppStore,
  modelLabel,
  providerGlyph,
  activeRunFor,
} from "@/lib/app-store";
import type { ChatController } from "@/lib/use-chat";


function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function Sidebar({
  chat,
  onOpenSkills,
  onOpenConnections,
  onOpenSearch,
}: {
  chat: ChatController;
  onOpenSkills?: () => void;
  onOpenConnections?: () => void;
  onOpenSearch?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const conversations = useAppStore((s) => s.conversations);
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const loadConversations = useAppStore((s) => s.loadConversations);
  const deleteConversation = useAppStore((s) => s.deleteConversation);
  const runs = useAppStore((s) => s.runs);
  const mainView = useAppStore((s) => s.mainView);
  const setMainView = useAppStore((s) => s.setMainView);
  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId,
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={cn(
          "z-40 flex h-full w-[272px] shrink-0 flex-col border-r border-border bg-bg-elevated/40 transition-transform",
          "fixed lg:static",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0 lg:w-0 lg:border-0 lg:overflow-hidden",
        )}
      >
        {sidebarOpen && (
          <div className="flex w-[272px] flex-col h-full">
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-strong text-white shadow-sm">
                  <Sparkles size={15} />
                </span>
                <div>
                  <h1 className="text-[15px] font-bold tracking-tight text-fg leading-none">
                    Omnia
                  </h1>
                  <p className="text-[10.5px] text-fg-muted mt-0.5">
                    {activeConversation
                      ? `${providerGlyph(activeConversation.provider as any)} ${modelLabel(
                          activeConversation.provider as any,
                          activeConversation.model,
                        )}`
                      : "Multi-provider workspace"}
                  </p>
                </div>
              </div>
              <Tooltip text="Collapse sidebar">
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-hover hover:text-fg lg:hidden"
                >
                  <PanelLeft size={15} />
                </button>
              </Tooltip>
            </div>

            <div className="px-3 pb-2">
              <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl border border-border bg-bg-subtle p-1">
                <button
                  onClick={() => setMainView("chat")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium transition-colors",
                    mainView === "chat"
                      ? "bg-bg-elevated text-fg shadow-sm"
                      : "text-fg-muted hover:text-fg-secondary",
                  )}
                >
                  <MessageCircle size={14} />
                  Chat
                </button>
                <button
                  onClick={() => setMainView("brain")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium transition-colors",
                    mainView === "brain"
                      ? "bg-bg-elevated text-fg shadow-sm"
                      : "text-fg-muted hover:text-fg-secondary",
                  )}
                >
                  <Brain size={14} />
                  Brain
                </button>
              </div>
              {mainView === "chat" && (
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    onMouseEnter={() => setMenuOpen(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-bg-elevated px-3 py-2 text-[13.5px] font-medium text-fg hover:border-accent/40 hover:bg-bg-hover transition-colors"
                  >
                    <Plus size={15} />
                    New chat
                  </button>
                  {menuOpen && (
                    <div
                      onMouseLeave={() => setMenuOpen(false)}
                      className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-soft"
                    >
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          chat.startNew();
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] hover:bg-bg-hover"
                      >
                        <MessageCircle size={14} className="text-accent" />
                        <span>
                          New chat
                          <span className="block text-[11px] text-fg-muted">Plain conversation</span>
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setAttachOpen(true);
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] hover:bg-bg-hover"
                      >
                        <Briefcase size={14} className="text-accent" />
                        <span>
                          New workspace
                          <span className="block text-[11px] text-fg-muted">
                            Chat bound to a project folder
                          </span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
              {attachOpen && (
                <AttachWorkspaceDialog chat={chat} onClose={() => setAttachOpen(false)} />
              )}
            </div>

            {mainView === "chat" && (
            <div className="flex-1 overflow-y-auto px-2 py-1">
              {conversations.length === 0 && (
                <p className="px-3 pt-4 text-[12px] text-fg-muted">
                  No conversations yet. Start a new chat to get going.
                </p>
              )}
              {conversations.map((c) => {
                const active = c.id === activeConversationId;
                const live = activeRunFor(runs, c.id);
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "group relative mb-0.5 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors",
                      active
                        ? "bg-accent-soft/70"
                        : "hover:bg-bg-hover",
                    )}
                    onClick={() => {
                      void chat.openConversation(c.id);
                    }}
                  >
                    {live ? (
                      <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                        <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-accent/50" />
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                      </span>
                    ) : (
                      <MessageSquare
                        size={14}
                        className={cn(
                          "shrink-0",
                          active ? "text-accent" : "text-fg-muted",
                        )}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-fg">
                        {c.title}
                      </p>
                      <p className="truncate text-[10.5px] text-fg-muted">
                        {live ? (
                          <span className="font-medium text-accent">
                            {live.activity}
                          </span>
                        ) : (
                          timeAgo(c.updatedAt)
                        )}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteConversation(c.id);
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-fg-muted opacity-0 group-hover:opacity-100 hover:bg-danger-soft hover:text-danger transition-opacity"
                      title="Delete conversation"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
            )}
            {mainView === "brain" && (
              <div className="flex-1 overflow-y-auto px-4 py-3">
                <p className="text-[12px] leading-relaxed text-fg-muted">
                  The Company Brain answers from the FalkorDB knowledge graph —
                  people, services, tickets, decisions — and remembers earlier
                  sessions. Its own past sessions live in the Brain panel.
                </p>
              </div>
            )}

            <div className="border-t border-border p-2.5 space-y-0.5">
              <button
                onClick={onOpenSkills}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-fg-secondary hover:bg-bg-hover hover:text-fg transition-colors"
              >
                <BookOpen size={15} className="text-accent" />
                Skills
              </button>
              <button
                onClick={onOpenSearch}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-fg-secondary hover:bg-bg-hover hover:text-fg transition-colors"
              >
                <Globe size={15} className="text-accent" />
                Search providers
              </button>
              <button
                onClick={onOpenConnections}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-fg-secondary hover:bg-bg-hover hover:text-fg transition-colors"
              >
                <Plug size={15} className="text-accent" />
                Connections
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
