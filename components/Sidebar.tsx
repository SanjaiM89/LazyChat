"use client";

import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  MessageSquare,
  MessageCircle,
  Brain,
  Briefcase,
  BookOpen,
  Plug,
  PanelLeftClose,
  Globe,
  Folder,
  Pencil,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  MoreHorizontal,
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { cn, Tooltip, Segmented } from "@/components/ui";
import { OmniaLogo } from "@/components/brand/OmniaLogo";
import { BrandIcon, modelIconKey } from "@/components/brand/BrandIcon";
import { UserMenu } from "@/components/UserMenu";
import { AttachWorkspaceDialog } from "@/components/workspace/AttachWorkspaceDialog";
import { RenameWorkspaceDialog } from "@/components/workspace/RenameWorkspaceDialog";
import { workspaceApi } from "@/lib/workspace/client";
import { useSidebarLayout } from "@/lib/use-sidebar-layout";
import type { ConversationMeta } from "@/lib/chat-store";
import type { Workspace } from "@/lib/workspace/types";
import {
  useAppStore,
  modelLabel,
  activeRunFor,
} from "@/lib/app-store";
import type { ChatController } from "@/lib/use-chat";


/**
 * A section heading in the sidebar. The count and the optional trailing action
 * keep the two lists (Chats, Workspaces) legible as separate things rather than
 * one undifferentiated feed of rows.
 */
function SectionHeader({
  label,
  count,
  action,
  children,
}: {
  label: string;
  count?: number;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-5">
      <span className="eyebrow">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="rounded-full border border-border bg-bg-surface-200 px-1.5 font-mono text-[10px] leading-4 text-fg-muted">
          {count}
        </span>
      )}
      {children}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

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
  // Selecting a workspace narrows the Chats list to the chats bound to it.
  // Null means "all chats" — the unfiltered default, not an empty state.
  const [workspaceFilterId, setWorkspaceFilterId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [renaming, setRenaming] = useState<Workspace | null>(null);
  const { open: sidebarOpen, close: closeSidebar, isWide } = useSidebarLayout();
  const conversations = useAppStore((s) => s.conversations);
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const loadConversations = useAppStore((s) => s.loadConversations);
  const deleteConversation = useAppStore((s) => s.deleteConversation);
  const pinnedConversations = useAppStore((s) => s.pinnedConversations);
  const archivedConversations = useAppStore((s) => s.archivedConversations);
  const pinConversation = useAppStore((s) => s.pinConversation);
  const unpinConversation = useAppStore((s) => s.unpinConversation);
  const archiveConversation = useAppStore((s) => s.archiveConversation);
  const unarchiveConversation = useAppStore((s) => s.unarchiveConversation);
  const [chatMenuFor, setChatMenuFor] = useState<string | null>(null);

  // Any click outside the open chat menu dismisses it.
  useEffect(() => {
    if (!chatMenuFor) return;
    const dismiss = () => setChatMenuFor(null);
    document.addEventListener("click", dismiss);
    return () => document.removeEventListener("click", dismiss);
  }, [chatMenuFor]);
  const conversationWorkspaces = useAppStore((s) => s.conversationWorkspaces);
  const runs = useAppStore((s) => s.runs);
  const mainView = useAppStore((s) => s.mainView);
  const setMainView = useAppStore((s) => s.setMainView);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const r = await workspaceApi.workspaces();
      setWorkspaces(Array.isArray(r.workspaces) ? r.workspaces : []);
    } catch {
      setWorkspaces([]);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);
  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  const workspaceFilter = useMemo(
    () => workspaces.find((w) => w.id === workspaceFilterId) ?? null,
    [workspaces, workspaceFilterId],
  );
  // Move a workspace one place up or down in the display order.
  const reorderWorkspace = useCallback(
    async (id: string, direction: -1 | 1) => {
      const index = workspaces.findIndex((w) => w.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= workspaces.length) return;
      // insertBefore semantics: land before the workspace that follows the
      // target, or at the end when moving the last one up.
      const before = workspaces[direction === -1 ? target : target + 1]?.id;
      try {
        const res = await fetch(`/api/workspace/workspaces/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ before: before ?? null }),
        });
        if (res.ok) await refreshWorkspaces();
      } catch {
      }
    },
    [workspaces, refreshWorkspaces],
  );

  const visibleConversations = useMemo(
    () =>
      workspaceFilterId
        ? conversations.filter(
            (c) => conversationWorkspaces[c.id]?.id === workspaceFilterId,
          )
        : conversations,
    [conversations, conversationWorkspaces, workspaceFilterId],
  );
  // Pinned chats head the list in pin order; archived ones leave it but stay
  // reachable, so nothing is ever lost by archiving.
  const pinnedChats = useMemo(
    () => pinnedConversations
      .map((id) => visibleConversations.find((c) => c.id === id))
      .filter((c): c is ConversationMeta => Boolean(c)),
    [pinnedConversations, visibleConversations],
  );
  const listedChats = useMemo(
    () => visibleConversations.filter(
      (c) => !pinnedConversations.includes(c.id) && !archivedConversations.includes(c.id),
    ),
    [visibleConversations, pinnedConversations, archivedConversations],
  );
  const archivedChats = useMemo(
    () => archivedConversations
      .map((id) => conversations.find((c) => c.id === id))
      .filter((c): c is ConversationMeta => Boolean(c)),
    [archivedConversations, conversations],
  );

  const renderChat = (c: ConversationMeta) => {

                const active = c.id === activeConversationId;
                const live = activeRunFor(runs, c.id);
                const bound = conversationWorkspaces[c.id];
                const logo = modelIconKey(c.model, c.provider as string);
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "group relative mb-px flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors duration-150",
                      active
                        ? "bg-bg-surface-300 text-fg"
                        : "text-fg-secondary hover:bg-bg-hover hover:text-fg",
                    )}
                    onClick={() => {
                      void chat.openConversation(c.id);
                      // On a narrow window the sidebar is a drawer over the
                      // chat, so picking a conversation dismisses it.
                      if (!isWide) closeSidebar();
                    }}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-brand transition-all duration-300 [transition-timing-function:var(--ease-out)]",
                        active ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0",
                      )}
                    />
                    {live ? (
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        <span className="live-dot" />
                      </span>
                    ) : (
                      <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center transition-opacity", active ? "opacity-100" : "opacity-70 group-hover:opacity-100")}>
                        <BrandIcon
                          name={logo}
                          size={14}
                          fallback={<MessageSquare size={14} className={active ? "text-accent" : "text-fg-muted"} />}
                        />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-normal leading-5">
                        {c.title}
                      </p>
                      <p className="flex items-center gap-1 truncate text-[11px] leading-4 text-fg-muted">
                        {bound && (
                          <Folder size={10} className="shrink-0 text-fg-muted/80" />
                        )}
                        {live ? (
                          <span className="text-shine truncate font-medium">
                            {live.activity}
                          </span>
                        ) : bound ? (
                          <span className="truncate">{bound.name}</span>
                        ) : (
                          <span className="truncate">
                            {timeAgo(c.updatedAt)} · {modelLabel(c.provider as any, c.model)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setChatMenuFor(chatMenuFor === c.id ? null : c.id);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-fg-muted opacity-0 transition-all duration-200 group-hover:opacity-100 focus-visible:opacity-100 hover:border-border hover:bg-bg-hover hover:text-fg"
                        title="Chat actions"
                      >
                        <MoreHorizontal size={13} />
                      </button>
                      {chatMenuFor === c.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-7 top-0 z-50 w-40 rounded-lg border border-border bg-bg-overlay p-1 shadow-pop animate-scale-in"
                        >
                          <MenuRow
                            icon={pinnedConversations.includes(c.id) ? <PinOff size={12} /> : <Pin size={12} />}
                            label={pinnedConversations.includes(c.id) ? "Unpin" : "Pin to top"}
                            onClick={() => {
                              void (pinnedConversations.includes(c.id)
                                ? unpinConversation(c.id)
                                : pinConversation(c.id));
                              setChatMenuFor(null);
                            }}
                          />
                          <MenuRow
                            icon={<Archive size={12} />}
                            label="Archive"
                            onClick={() => {
                              void archiveConversation(c.id);
                              setChatMenuFor(null);
                            }}
                          />
                          <MenuRow
                            icon={<Trash2 size={12} />}
                            label="Delete"
                            danger
                            onClick={() => {
                              void deleteConversation(c.id);
                              setChatMenuFor(null);
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
  };

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] animate-fade-in lg:hidden"
          onClick={() => closeSidebar()}
        />
      )}
      <aside
        className={cn(
          "z-40 flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-bg-alternative",
          "transition-[transform,width] duration-300 [transition-timing-function:var(--ease-out)]",
          "fixed lg:static",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0 lg:w-0 lg:border-0 lg:overflow-hidden",
        )}
      >
        {sidebarOpen && (
          <div className="flex h-full w-[264px] flex-col animate-slide-in-left">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <OmniaLogo height={22} />
              <Tooltip text="Collapse sidebar">
                <button
                  onClick={() => closeSidebar()}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg lg:hidden"
                >
                  <PanelLeftClose size={15} />
                </button>
              </Tooltip>
            </div>

            <div className="space-y-2 px-3 pt-3">
              <Segmented
                value={mainView === "brain" ? "brain" : "chat"}
                onChange={(v) => setMainView(v)}
                options={[
                  { value: "chat", label: "Chat", icon: <MessageCircle size={13} /> },
                  { value: "brain", label: "Brain", icon: <Brain size={13} /> },
                ]}
              />
              {mainView === "chat" && (
                <div className="relative">
                  <div className="flex">
                    <button
                      onClick={() => chat.startNew()}
                      className="btn-sheen group flex h-8 flex-1 items-center gap-2 rounded-l-md border border-[color:var(--brand-button-border)] bg-[color:var(--brand-button)] px-2.5 text-[13px] font-medium text-[color:var(--brand-button-text)] transition-[filter,box-shadow] duration-200 hover:brightness-110 hover:shadow-[0_0_0_3px_var(--accent-soft)]"
                    >
                      <Plus size={14} className="transition-transform duration-300 group-hover:rotate-90" />
                      New chat
                    </button>
                    <button
                      onClick={() => setMenuOpen((v) => !v)}
                      aria-label="More ways to start"
                      className="flex h-8 w-8 items-center justify-center rounded-r-md border border-l-0 border-[color:var(--brand-button-border)] bg-[color:var(--brand-button)] text-[color:var(--brand-button-text)] transition-[filter] hover:brightness-110"
                    >
                      <ChevronDown size={14} className={cn("transition-transform duration-300", menuOpen && "rotate-180")} />
                    </button>
                  </div>
                  {menuOpen && (
                    <div
                      onMouseLeave={() => setMenuOpen(false)}
                      className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-border-strong bg-bg-overlay p-1 shadow-pop animate-scale-in"
                    >
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          chat.startNew();
                        }}
                        className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-bg-hover"
                      >
                        <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-bg-surface-200 text-accent">
                          <MessageCircle size={13} />
                        </span>
                        <span>
                          New chat
                          <span className="block text-[11.5px] text-fg-muted">Plain conversation</span>
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setAttachOpen(true);
                        }}
                        className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-bg-hover"
                      >
                        <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-bg-surface-200 text-accent">
                          <Briefcase size={13} />
                        </span>
                        <span>
                          New workspace
                          <span className="block text-[11.5px] text-fg-muted">Chat bound to a project folder</span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
              {attachOpen && (
                <AttachWorkspaceDialog
                  chat={chat}
                  onClose={() => {
                    setAttachOpen(false);
                    void refreshWorkspaces();
                  }}
                />
              )}
              {renaming && (
                <RenameWorkspaceDialog
                  workspace={renaming}
                  onClose={() => setRenaming(null)}
                  onRenamed={refreshWorkspaces}
                />
              )}
            </div>

            {mainView === "chat" && (
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {/* Chats and workspaces are separate lists, not one mixed feed:
                  a workspace is a project folder, a chat is a conversation, and
                  binding one to the other is an explicit choice made in the
                  header chip — so the sidebar shows that relationship instead of
                  flattening it. */}
              <SectionHeader label="Chats" count={visibleConversations.length}>
                {workspaceFilter && (
                  <button
                    onClick={() => setWorkspaceFilterId(null)}
                    className="ml-1 rounded-full border border-brand/30 bg-accent-soft px-1.5 text-[10px] font-medium leading-4 text-accent transition-opacity hover:opacity-80 animate-scale-in"
                    title="Show all chats"
                  >
                    {workspaceFilter.title} ✕
                  </button>
                )}
              </SectionHeader>

              {visibleConversations.length === 0 && (
                <div className="mx-1 rounded-md border border-dashed border-border px-3 py-3 text-[12px] leading-relaxed text-fg-muted animate-fade-in">
                  {workspaceFilter
                    ? `No chats in ${workspaceFilter.title} yet.`
                    : "No conversations yet. Start a new chat to get going."}
                </div>
              )}
              <div className="stagger [--stagger:25ms]">
                {pinnedChats.length > 0 && (
                  <div className="mb-1.5">
                    {pinnedChats.map((c) => renderChat(c))}
                  </div>
                )}
                {listedChats.map((c) => renderChat(c))}
              </div>
              {archivedChats.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <SectionHeader label="Archived" count={archivedChats.length} />
                  {archivedChats.map((c) => (
                    <div
                      key={c.id}
                      className="group relative mb-px flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 opacity-60 transition-colors duration-150 hover:bg-bg-hover hover:opacity-100"
                      onClick={() => void chat.openConversation(c.id)}
                    >
                      <Archive size={12} className="shrink-0 text-fg-muted" />
                      <p className="min-w-0 flex-1 truncate text-[12.5px] leading-5 text-fg-secondary">
                        {c.title}
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void unarchiveConversation(c.id);
                        }}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-bg-hover hover:text-fg focus-visible:opacity-100"
                        title="Restore to the chat list"
                      >
                        <ArchiveRestore size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <SectionHeader
                label="Workspaces"
                count={workspaces.length}
                action={
                  <Tooltip text="New workspace">
                    <button
                      onClick={() => setAttachOpen(true)}
                      className="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted transition-all duration-200 hover:rotate-90 hover:bg-bg-hover hover:text-fg"
                    >
                      <Plus size={13} />
                    </button>
                  </Tooltip>
                }
              />

              {workspaces.length === 0 && (
                <div className="mx-1 rounded-md border border-dashed border-border px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
                  No workspaces. Add a project folder to give a chat its own
                  files, shell, and memory.
                </div>
              )}
              {workspaces.map((w, index) => {
                const selected = workspaceFilterId === w.id;
                return (
                  <div
                    key={w.id}
                    className={cn(
                      "group relative mb-px flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors duration-150",
                      selected ? "bg-bg-surface-300" : "hover:bg-bg-hover",
                    )}
                    onClick={() => setWorkspaceFilterId(selected ? null : w.id)}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-brand transition-all duration-300",
                        selected ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0",
                      )}
                    />
                    <Folder
                      size={14}
                      className={cn(
                        "shrink-0 transition-colors",
                        selected ? "text-accent" : "text-fg-muted group-hover:text-fg-secondary",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-[13px] leading-5",
                          selected ? "text-fg" : "text-fg-secondary",
                        )}
                      >
                        {w.title}
                        {w.dir_status === "missing-dir" && (
                          <span
                            title="The folder is gone. The workspace is kept so its history stays reachable."
                            className="ml-1.5 align-middle text-[10px] text-warn"
                          >
                            missing
                          </span>
                        )}
                      </p>
                      <p className="truncate font-mono text-[10.5px] leading-4 text-fg-muted">
                        {w.path}
                      </p>
                    </div>
                    <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void reorderWorkspace(w.id, -1);
                        }}
                        disabled={index === 0}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-30"
                        title="Move up"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void reorderWorkspace(w.id, 1);
                        }}
                        disabled={index === workspaces.length - 1}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-30"
                        title="Move down"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenaming(w);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
                        title="Rename workspace"
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
            {mainView === "brain" && (
              <div className="flex-1 overflow-y-auto px-3 py-4 animate-fade-in">
                <div className="relative overflow-hidden rounded-lg border border-border bg-bg-surface-100 p-3">
                  <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-brand/15 blur-2xl" />
                  <p className="eyebrow mb-1.5">Company Brain</p>
                  <p className="text-[12px] leading-relaxed text-fg-secondary">
                    Answers from the FalkorDB knowledge graph — people, services,
                    tickets, decisions — and remembers earlier sessions. Its own
                    past sessions live in the Brain panel.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-px border-t border-border p-2">
              <NavRow icon={<BookOpen size={14} />} label="Skills" onClick={onOpenSkills} />
              <NavRow icon={<Globe size={14} />} label="Search providers" onClick={onOpenSearch} />
              <NavRow icon={<Plug size={14} />} label="Connections" onClick={onOpenConnections} />
              <ThemeSwitcher />
              <UserMenu />
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors",
        danger
          ? "text-danger hover:bg-danger-soft"
          : "text-fg-secondary hover:bg-bg-hover hover:text-fg",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function NavRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-fg-secondary transition-colors hover:bg-bg-hover hover:text-fg"
    >
      <span className="text-fg-muted transition-[color,transform] duration-200 group-hover:scale-110 group-hover:text-accent">{icon}</span>
      {label}
    </button>
  );
}

/** System / light / dark, with a cross-fade while the palette swaps. */
function ThemeSwitcher() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  return (
    <div className="flex items-center justify-between px-2.5 py-1">
      <span className="text-[12px] text-fg-muted">Theme</span>
      <Segmented
        className="w-[96px]"
        value={theme}
        onChange={(t) => {
          const root = document.documentElement;
          root.classList.add("theme-transition");
          setTheme(t);
          window.setTimeout(() => root.classList.remove("theme-transition"), 400);
        }}
        options={[
          { value: "system", label: <Monitor size={12} aria-label="System" /> },
          { value: "light", label: <Sun size={12} aria-label="Light" /> },
          { value: "dark", label: <Moon size={12} aria-label="Dark" /> },
        ]}
      />
    </div>
  );
}
