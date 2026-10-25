"use client";

import * as React from "react";
import { Lock, ShieldCheck, ShieldHalf, Zap } from "lucide-react";

import { useAppStore } from "@/lib/app-store";
import { Dropdown, MenuItem } from "@/components/ui";
import {
  applyPreset,
  currentPreset,
  describePreset,
  presetOptions,
  type SandboxMode,
} from "@/lib/agent/permissions";

/**
 * The permission chip.
 *
 * It shows the preset the session runs under and lets the user change it. The
 * choice travels with every run, so switching to "Full access" stops the
 * agent from asking before it runs a command.
 */

const ICONS: Record<SandboxMode, React.ReactNode> = {
  "read-only": <Lock size={12} />,
  "workspace-write": <ShieldHalf size={12} />,
  "danger-full-access": <Zap size={12} />,
};

export function PermissionChip() {
  const permissions = useAppStore((s) => s.permissions);
  const setPermissions = useAppStore((s) => s.setPermissions);
  const recorded = useAppStore((s) => s.permissionPreset);
  const setPreset = useAppStore((s) => s.setPermissionPreset);
  const workspaces = useAppStore((s) => s.conversationWorkspaces);
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const hasWorkspace = Boolean(activeConversationId && workspaces[activeConversationId]);

  const current = currentPreset(permissions, recorded, hasWorkspace);
  const mode = permissions.mode;

  return (
    <Dropdown
      align="right"
      trigger={
        <button
          className="flex items-center gap-1.5 rounded-full border border-border bg-bg-surface-200 px-2.5 py-1 text-[11px] text-fg-secondary transition-colors hover:bg-bg-hover hover:text-fg"
          title="What the agent may do without asking"
        >
          {ICONS[mode]}
          {describePreset(current)}
        </button>
      }
    >
      <div className="px-2.5 py-1.5 text-[11px] leading-relaxed text-fg-muted">
        What the agent may do without asking.
      </div>
      {presetOptions(hasWorkspace).map((preset) => {
        const active = preset.name === current.name;
        return (
          <MenuItem
            key={preset.name}
            active={active}
            onClick={() => {
              const next = applyPreset(preset.name, hasWorkspace);
              if (!next) return;
              setPermissions(next);
              setPreset(preset.name);
            }}
          >
            <span className="flex flex-col">
              <span className="text-[12px]">{preset.label}</span>
              <span className="text-[10px] text-fg-muted">{preset.description}</span>
            </span>
          </MenuItem>
        );
      })}
      {current.name === "custom" && (
        <div className="px-2.5 py-1.5 text-[10px] text-fg-muted">
          The session runs a combination that is not one of the presets. Pick one to change it.
        </div>
      )}
      <div className="mt-1 border-t border-border px-2.5 py-1.5 text-[10px] text-fg-muted">
        <ShieldCheck size={11} className="mr-1 inline" />
        Commands always ask unless the session has full access.
      </div>
    </Dropdown>
  );
}
