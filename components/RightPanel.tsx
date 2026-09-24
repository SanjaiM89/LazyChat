"use client";

import * as React from "react";
import { useAppStore } from "@/lib/app-store";
import { ArtifactPanel } from "@/components/panels/ArtifactPanel";
import { SandboxPanel } from "@/components/panels/SandboxPanel";
import { AgentsPanel } from "@/components/panels/AgentsPanel";
import { cn } from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  Right-hand side panel, switches by active tab.                     */
/* ------------------------------------------------------------------ */

export function RightPanel() {
  const panel = useAppStore((s) => s.panel);

  if (!panel) return null;

  return (
    <>
      {/* mobile: overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/30 md:hidden"
        onClick={() => useAppStore.getState().setPanel(null)}
      />
      <aside
        className={cn(
          "z-50 fixed inset-y-0 right-0 w-[min(92vw,480px)] border-l border-border bg-bg-elevated/60 backdrop-blur",
          "md:static md:w-[430px] md:bg-transparent md:backdrop-blur-none",
        )}
      >
        {panel === "artifacts" && <ArtifactPanel />}
        {panel === "sandbox" && <SandboxPanel />}
        {panel === "agents" && <AgentsPanel />}
      </aside>
    </>
  );
}
