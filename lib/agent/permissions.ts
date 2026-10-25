import { toolEffect, type ToolEffect } from "@/lib/agent/catalog";

/**
 * What a session is allowed to do.
 *
 * The model of three sandbox modes and an approval policy follows the harness
 * (read-only / workspace-write / danger-full-access, ask or never), but the
 * decision is made here, in Omnia, against the tool catalog.
 */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "ask" | "never";
/**
 * The names the harness reserves: `custom` is the derived state of a knob
 * combination that matches no preset, and `auto` belongs to the Auto review
 * integration. Neither may appear in the preset table.
 */
export type PermissionPreset = string;

export interface PermissionSettings {
  mode: SandboxMode;
  policy: ApprovalPolicy;
}

export const DEFAULT_PERMISSIONS: PermissionSettings = {
  mode: "workspace-write",
  policy: "ask",
};

/** One named bundle of a sandbox mode and an approval policy. */
export interface PresetEntry {
  name: string;
  label: string;
  description: string;
  mode: SandboxMode;
  policy: ApprovalPolicy;
}

/**
 * The preset table.
 *
 * Each entry bundles one sandbox mode with one approval policy, so the user
 * picks a single thing. The reserved names cannot appear here.
 */
export const PERMISSION_PRESET_TABLE: PresetEntry[] = [
  {
    name: "read-only",
    label: "Read only",
    description: "Nothing may change.",
    mode: "read-only",
    policy: "ask",
  },
  {
    name: "workspace-write",
    label: "Workspace",
    description: "May write inside the session's folder; commands need approval.",
    mode: "workspace-write",
    policy: "ask",
  },
  {
    name: "workspace-write-never",
    label: "Workspace, no prompts",
    description: "May write inside the session's folder; commands are refused rather than asked about.",
    mode: "workspace-write",
    policy: "never",
  },
  {
    name: "danger-full-access",
    label: "Full access",
    description: "May run commands and agents without asking.",
    mode: "danger-full-access",
    policy: "never",
  },
];

/** The preset a fresh session starts on. */
export const DEFAULT_PRESET = "workspace-write";

/** The names the harness reserves. */
export const RESERVED_PRESET_NAMES = ["custom", "auto"];

/**
 * The adaptive preset: read-only until a folder is attached, then the folder
 * may be written. Its knobs depend on the session, so it is not a table entry.
 */
export const ADAPTIVE_PRESET = "adaptive";

/**
 * The settings an adaptive session has.
 *
 * @param hasWorkspace - Whether a folder is attached.
 */
export function adaptiveSettings(hasWorkspace: boolean): PermissionSettings {
  return { mode: hasWorkspace ? "workspace-write" : "read-only", policy: "ask" };
}

/** The table entry that matches these settings, if any. */
export function presetMatching(settings: PermissionSettings): PresetEntry | null {
  return (
    PERMISSION_PRESET_TABLE.find(
      (entry) => entry.mode === settings.mode && entry.policy === settings.policy,
    ) ?? null
  );
}

export interface CurrentPreset {
  /** The preset name, or `custom` when the knobs match no entry. */
  name: string;
  /** The entry behind the name, unless the state is `custom`. */
  entry: PresetEntry | null;
  /** The settings in force. */
  settings: PermissionSettings;
}

/**
 * Resolve the current preset.
 *
 * The recorded selection wins while it still matches; otherwise the first
 * matching table entry is the current one, and a combination that matches
 * nothing is `custom`. `custom` is a derived state: a user may leave it but
 * cannot select it.
 */
export function currentPreset(
  settings: PermissionSettings,
  recorded?: string | null,
  hasWorkspace = false,
): CurrentPreset {
  if (recorded === ADAPTIVE_PRESET) {
    const adaptive = adaptiveSettings(hasWorkspace);
    if (adaptive.mode === settings.mode && adaptive.policy === settings.policy) {
      return { name: ADAPTIVE_PRESET, entry: null, settings };
    }
  }
  if (recorded) {
    const entry = PERMISSION_PRESET_TABLE.find((e) => e.name === recorded);
    if (entry && entry.mode === settings.mode && entry.policy === settings.policy) {
      return { name: entry.name, entry, settings };
    }
  }
  const matching = presetMatching(settings);
  if (matching) return { name: matching.name, entry: matching, settings };
  return { name: "custom", entry: null, settings };
}

/** The selectable rows: the table, plus the adaptive preset. Never `custom`. */
export function presetOptions(hasWorkspace = false): Array<{
  name: string;
  label: string;
  description: string;
}> {
  return [
    {
      name: ADAPTIVE_PRESET,
      label: "Adaptive",
      description: "Read only until a folder is attached.",
    },
    ...PERMISSION_PRESET_TABLE.map((entry) => ({
      name: entry.name,
      label: entry.label,
      description: entry.description,
    })),
  ];
}

/**
 * The settings a preset name selects.
 *
 * @param name - The preset name.
 * @param hasWorkspace - Whether a folder is attached.
 * @returns The settings, or null when the name is not selectable.
 */
export function applyPreset(name: string, hasWorkspace = false): PermissionSettings | null {
  if (name === ADAPTIVE_PRESET) return adaptiveSettings(hasWorkspace);
  const entry = PERMISSION_PRESET_TABLE.find((e) => e.name === name);
  if (!entry) return null;
  return { mode: entry.mode, policy: entry.policy };
}

export type PermissionOutcome = "allow" | "ask" | "deny";

export interface PermissionDecision {
  outcome: PermissionOutcome;
  reason: string;
  effect: ToolEffect;
}

/**
 * Decide what happens to a tool call.
 *
 * Reads and network calls always pass. Writes pass in workspace-write (the
 * workspace tools confine themselves to the attached folder) but not in
 * read-only. Running a command or spawning an agent always needs a human
 * decision unless the session runs with full access.
 */
export function decidePermission(
  toolName: string,
  settings: PermissionSettings,
): PermissionDecision {
  const effect = toolEffect(toolName);
  const { mode, policy } = settings;

  if (effect === "read" || effect === "network") {
    return { outcome: "allow", reason: "", effect };
  }
  if (mode === "danger-full-access") {
    return { outcome: "allow", reason: "", effect };
  }
  if (mode === "read-only") {
    return {
      outcome: "deny",
      reason: `This session is read-only, so "${toolName}" is not allowed.`,
      effect,
    };
  }
  if (effect === "write") {
    return { outcome: "allow", reason: "", effect };
  }
  // exec and spawn: the session may do it, but a human decides.
  if (policy === "never") {
    return {
      outcome: "deny",
      reason: `The approval policy is "never", so "${toolName}" cannot ask for permission and was not run.`,
      effect,
    };
  }
  return {
    outcome: "ask",
    reason:
      effect === "exec"
        ? `Run "${toolName}" on this machine?`
        : `Start "${toolName}"?`,
    effect,
  };
}

/** A short label for the mode, for the header chip. */
export function describePermissions(settings: PermissionSettings): string {
  switch (settings.mode) {
    case "read-only":
      return "Read only";
    case "workspace-write":
      return settings.policy === "never" ? "Workspace" : "Workspace (ask)";
    case "danger-full-access":
      return "Full access";
  }
}

/** A short label for the preset, for the header chip and the command output. */
export function describePreset(preset: CurrentPreset): string {
  if (preset.name === "custom") return "Custom";
  if (preset.name === ADAPTIVE_PRESET) return "Adaptive";
  return preset.entry?.label ?? preset.name;
}
