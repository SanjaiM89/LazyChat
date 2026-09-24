"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/app-store";
import { DEFAULT_DISPLAY, fontStack } from "@/lib/display";
import { useChatController } from "@/lib/use-chat";
import { useSandboxRegistry } from "@/lib/use-sandbox";
import { Sidebar } from "@/components/Sidebar";
import { ChatHeader } from "@/components/ChatHeader";
import { ChatView } from "@/components/ChatView";
import { Composer } from "@/components/Composer";
import { RightPanel } from "@/components/RightPanel";
import { SkillsDialog } from "@/components/dialogs/SkillsDialog";
import { ConnectionsDialog } from "@/components/dialogs/ConnectionsDialog";
import { SearchProvidersDialog } from "@/components/dialogs/SearchProvidersDialog";

/* ------------------------------------------------------------------ */
/*  App shell: sidebar | chat | side panel, theme + store boot         */
/* ------------------------------------------------------------------ */

export function App() {
  const theme = useAppStore((s) => s.theme);
  const display = useAppStore((s) => s.display) ?? DEFAULT_DISPLAY;
  const chat = useChatController();
  useSandboxRegistry();
  const [modal, setModal] = useState<null | "skills" | "connections" | "search">(null);

  // apply theme class to <html> so tailwind dark: variants + css vars work
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
  }, [theme]);

  // reading display: font family + size as CSS vars consumed by chat CSS
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--reading-font", fontStack(display.font));
    root.style.setProperty("--reading-size", `${display.fontSize}px`);
  }, [display]);

  // load user-defined custom providers so the picker/sidebar can show them
  useEffect(() => {
    void useAppStore.getState().loadCustomProviders();
    void useAppStore.getState().loadProviderKeys();
  }, []);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
      <Sidebar
        chat={chat}
        onOpenSkills={() => setModal("skills")}
        onOpenConnections={() => setModal("connections")}
        onOpenSearch={() => setModal("search")}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader chat={chat} />
        <main className="flex flex-1 flex-col overflow-hidden">
          <ChatView chat={chat} />
          <Composer chat={chat} />
        </main>
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
