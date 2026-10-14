"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/app-store";
import { DEFAULT_DISPLAY, fontStack } from "@/lib/display";
import { useSubchatController } from "@/lib/use-subchat";
import { useChatController } from "@/lib/use-chat";
import { useSandboxRegistry } from "@/lib/use-sandbox";
import { Sidebar } from "@/components/Sidebar";
import { ChatHeader } from "@/components/ChatHeader";
import { ChatView } from "@/components/ChatView";
import { Composer } from "@/components/Composer";
import { BrainApp } from "@/components/brain/BrainApp";
import { WorkspaceView } from "@/components/workspace/WorkspaceView";
import { SubchatPanel } from "@/components/SubchatPanel";
import { RightPanel } from "@/components/RightPanel";
import { SkillsDialog } from "@/components/dialogs/SkillsDialog";
import { ConnectionsDialog } from "@/components/dialogs/ConnectionsDialog";
import { SearchProvidersDialog } from "@/components/dialogs/SearchProvidersDialog";


import type { MainView } from "@/lib/app-store";

export function App({ initialView }: { initialView?: MainView }) {
  const theme = useAppStore((s) => s.theme);
  const mainView = useAppStore((s) => s.mainView);
  const display = useAppStore((s) => s.display) ?? DEFAULT_DISPLAY;
  const subchatOpen = useAppStore((s) => s.subchatOpen);
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const chat = useChatController();
  const subchat = useSubchatController(chat);
  useSandboxRegistry();
  const [modal, setModal] = useState<null | "skills" | "connections" | "search">(null);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--reading-font", fontStack(display.font));
    root.style.setProperty("--reading-size", `${display.fontSize}px`);
  }, [display]);

  useEffect(() => {
    void useAppStore.getState().loadCustomProviders();
    void useAppStore.getState().loadProviderKeys();
  }, []);

  // Deep link: /?view=brain opens the Company Brain inside this same shell.
  useEffect(() => {
    if (initialView === "brain" || initialView === "chat" || initialView === "workspace") {
      useAppStore.getState().setMainView(initialView);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subchatClearRef = useRef(subchat.clear);
  useEffect(() => {
    subchatClearRef.current = subchat.clear;
  });
  const firstChatRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (firstChatRef.current === undefined) {
      firstChatRef.current = activeConversationId;
      return;
    }
    if (firstChatRef.current !== activeConversationId) {
      firstChatRef.current = activeConversationId;
      subchatClearRef.current();
      useAppStore.getState().setSubchatOpen(false);
      useAppStore.getState().setSubchatSeed(null);
    }
  }, [activeConversationId]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
      <Sidebar
        chat={chat}
        onOpenSkills={() => setModal("skills")}
        onOpenConnections={() => setModal("connections")}
        onOpenSearch={() => setModal("search")}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {mainView === "workspace" ? (
          <main className="flex min-h-0 flex-1 overflow-hidden">
            <WorkspaceView />
          </main>
        ) : mainView === "brain" ? (
          <main className="flex min-h-0 flex-1 overflow-hidden">
            <BrainApp />
          </main>
        ) : (
          <>
            <ChatHeader chat={chat} />
            <main className="flex min-h-0 flex-1 overflow-hidden">
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <ChatView chat={chat} />
                <Composer chat={chat} />
              </div>
              {subchatOpen && <SubchatPanel subchat={subchat} />}
            </main>
          </>
        )}
      </div>

      <RightPanel />

      <SkillsDialog open={modal === "skills"} onClose={() => setModal(null)} />
      <SearchProvidersDialog open={modal === "search"} onClose={() => setModal(null)} />
      <ConnectionsDialog
        open={modal === "connections"}
        onClose={() => setModal(null)}
      />
    </div>
  );
}
