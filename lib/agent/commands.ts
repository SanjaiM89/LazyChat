/**
 * The slash-command registry.
 *
 * A command is a human instruction the app answers itself: it runs directly,
 * without a model turn, and returns its own output. The registry is the one
 * place that knows which commands exist, what they do, and what they answer.
 */
import {
  ADAPTIVE_PRESET,
  applyPreset,
  currentPreset,
  describePreset,
  presetOptions,
  type PermissionSettings,
} from "@/lib/agent/permissions";

export interface CommandContext {
  /** The conversation the command was typed in. */
  conversationId?: string;
  /** The text after the command name. */
  argument: string;
  /** The permission settings in force. */
  permissions: PermissionSettings;
  /** The preset name that was recorded for this session. */
  preset?: string | null;
  /** Whether a folder is attached to the session. */
  hasWorkspace: boolean;
  /** The user who typed the command. */
  userId: string;
  /** The chat settings, for the commands that start a run. */
  settings?: Record<string, unknown>;
  /** The folder attached to the session. */
  workspaceId?: string;
}

export interface CommandOutcome {
  /** What the command answers. */
  message: string;
  /** The permission settings the command selected. */
  permissions?: PermissionSettings;
  /** The preset name the command selected. */
  preset?: string;
  /** A run to attach to instead of starting a model turn. */
  runId?: string;
  /** The command failed. */
  error?: boolean;
}

export interface Command {
  name: string;
  description: string;
  run(ctx: CommandContext): Promise<CommandOutcome>;
}

const commands = new Map<string, Command>();

/**
 * Register a command.
 *
 * @param command - The command to register.
 * @throws When the name is already taken.
 */
export function registerCommand(command: Command): void {
  if (commands.has(command.name)) {
    throw new Error(`command '/${command.name}' is already registered`);
  }
  commands.set(command.name, command);
}

/** Every registered command, in registration order. */
export function listCommands(): Command[] {
  return [...commands.values()];
}

/** The command with this name, if there is one. */
export function findCommand(name: string): Command | undefined {
  return commands.get(name);
}

/** The command name a line asks for, if it asks for one. */
export function commandNameOf(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return null;
  const name = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase();
  return name || null;
}

// --- the commands -----------------------------------------------------------

registerCommand({
  name: "permission",
  description: "Show the permission preset, or switch to another one.",
  run: async (ctx) => {
    const current = currentPreset(ctx.permissions, ctx.preset, ctx.hasWorkspace);
    const argument = ctx.argument.trim();
    if (!argument) {
      const rows = presetOptions(ctx.hasWorkspace)
        .map((option) => `${option.name === current.name ? "*" : " "} ${option.name} — ${option.description}`)
        .join("\n");
      return {
        message:
          `The session runs with the "${current.name}" preset (${describePreset(current)}).\n` +
          `Sandbox: ${current.settings.mode}; approval: ${current.settings.policy}.\n\n` +
          `${rows}\n\nUse /permission <name> to switch.`,
      };
    }
    const next = applyPreset(argument, ctx.hasWorkspace);
    if (!next) {
      const names = presetOptions(ctx.hasWorkspace).map((o) => o.name).join(", ");
      return {
        message: `There is no permission preset called "${argument}". The available ones are: ${names}.`,
        error: true,
      };
    }
    return {
      message: `The session now runs with the "${argument}" preset.`,
      permissions: next,
      preset: argument,
    };
  },
});

registerCommand({
  name: "plan",
  description: "Draft a plan before any of the work is done.",
  run: async (ctx) => {
    if (!ctx.conversationId) {
      return { message: "A plan needs a conversation to live in.", error: true };
    }
    const { enterPlanMode, exitPlanMode } = await import("@/lib/plan-mode");
    if (ctx.argument.trim().toLowerCase() === "off") {
      await exitPlanMode(ctx.conversationId);
      return { message: "Plan mode is off. You can carry on with the work." };
    }
    await enterPlanMode(ctx.conversationId);
    return {
      message:
        "Plan mode is on. The next message is treated as the request to plan, and nothing is changed until " +
        "the plan is approved.",
    };
  },
});

registerCommand({
  name: "resume",
  description: "Carry on with the last run that never finished in this conversation.",
  run: async (ctx) => {
    if (!ctx.conversationId) {
      return { message: "A run needs a conversation to carry on in.", error: true };
    }
    const { listInterruptedRuns, resumeRun } = await import("@/lib/agent/recovery");
    const { prepareChatRun } = await import("@/lib/chat-runs");
    const interrupted = (await listInterruptedRuns(ctx.conversationId))[0];
    if (!interrupted) {
      return { message: "There is no interrupted run to carry on in this conversation.", error: true };
    }
    const { settings } = await prepareChatRun(ctx.settings as never);
    const result = await resumeRun(interrupted.runId, {
      settings,
      permissions: ctx.permissions,
      workspaceId: ctx.workspaceId,
    });
    if (!result.ok) {
      return { message: result.error ?? "The run could not be resumed.", error: true };
    }
    return {
      message: "Carrying on with the interrupted run.",
      runId: result.runId,
    };
  },
});

registerCommand({
  name: "help",
  description: "List the commands this app answers itself.",
  run: async () => {
    const rows = listCommands()
      .map((command) => `/${command.name} — ${command.description}`)
      .join("\n");
    return { message: `The commands are:\n\n${rows}` };
  },
});

/** The adaptive preset is offered alongside the table. */
export { ADAPTIVE_PRESET };
