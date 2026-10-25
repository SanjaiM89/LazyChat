"use client";

import * as React from "react";
import { useAppStore } from "@/lib/app-store";
import { ArtifactPanel } from "@/components/panels/ArtifactPanel";
import { SandboxPanel } from "@/components/panels/SandboxPanel";
import { AgentsPanel } from "@/components/panels/AgentsPanel";
import { FileExplorer } from "@/components/workspace/FileExplorer";
import { PluginPanel } from "@/components/agent/PluginPanel";
import { SessionBrowser } from "@/components/agent/SessionBrowser";
import { cn } from "@/components/ui";


export function RightPanel() {
  const panel = useAppStore((s) => s.panel);

  if (!panel) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-fade-in md:hidden"
        onClick={() => useAppStore.getState().setPanel(null)}
      />
      <aside
        className={cn(
          "glass z-50 fixed inset-y-0 right-0 w-[min(92vw,480px)] border-l border-border shadow-pop animate-slide-in-right",
          "md:static md:w-[430px] md:bg-bg-alternative md:shadow-none md:backdrop-blur-none",
        )}
      >
        {panel === "artifacts" && <ArtifactPanel />}
        {panel === "sandbox" && <SandboxPanel />}
        {panel === "agents" && <AgentsPanel />}
        {panel === "files" && <FileExplorer />}
        {panel === "plugins" && <PluginPanel />}
        {panel === "sessions" && <SessionBrowser />}
      </aside>
    </>
  );
}
