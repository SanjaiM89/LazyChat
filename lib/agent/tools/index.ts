import { buildWebTools } from "@/lib/agent/tools/web";
import { buildSessionEventTools } from "@/lib/agent/tools/session";
import { buildShellTools } from "@/lib/agent/tools/shell";
import { buildCodeTools } from "@/lib/agent/tools/code";
import { buildSpillTools } from "@/lib/agent/tools/spill";
import { buildAttachmentTools } from "@/lib/agent/tools/attachments";
import { buildSubagentTools } from "@/lib/agent/tools/subagent";
import { buildTeamTools } from "@/lib/agent/tools/team";
import { buildWorkflowTools } from "@/lib/agent/tools/workflow";
import { buildLspTools } from "@/lib/agent/tools/lsp";
import { buildBrowserTools } from "@/lib/agent/tools/browser";
import {
  buildDeliverableTools,
  buildInspectTools,
  buildMCPResourceTools,
  buildSkillTools,
} from "@/lib/agent/tools/misc";
import { buildPluginTools } from "@/lib/agent/tools/plugins";
import { buildWorktreeTools } from "@/lib/agent/tools/worktree";
import { buildPowershellTools } from "@/lib/agent/tools/powershell";
import type { SessionDirectory } from "@/lib/agent/session-dir";
import type { PermissionSettings } from "@/lib/agent/permissions";
import type { ChatSettings } from "@/lib/types";

/**
 * The tools the agent runtime adds on top of what the chat loop already
 * builds: the web, history, shell, code, subagent, job, skill, deliverable,
 * inspection, plugin and MCP resource tools.
 */
export function buildAgentTools(ctx: {
  conversationId?: string;
  cwd?: string;
  /** The session's working directory. Every directory-bound tool follows it. */
  sessionDir: SessionDirectory;
  /** Called when the model moves the session to another directory. */
  onCwdChange?: (dir: string) => void;
  /** The tools a program run by `code_run` may call. */
  programTools?: () => Record<string, unknown>;
  settings?: ChatSettings;
  permissions?: PermissionSettings;
  parentRunId?: string;
  workspaceId?: string;
}): Record<string, unknown> {
  return {
    ...buildWebTools(),
    ...buildSessionEventTools(ctx.conversationId),
    ...buildShellTools({
      sessionDir: ctx.sessionDir,
      cwd: ctx.cwd,
      sessionId: ctx.conversationId,
      onCwdChange: ctx.onCwdChange,
    }),
    ...buildCodeTools({ tools: ctx.programTools ?? (() => ({})), cwd: () => ctx.sessionDir.cwd }),
    ...buildSpillTools({ conversationId: ctx.conversationId }),
    ...buildAttachmentTools(),
    ...(ctx.settings
      ? buildSubagentTools({
          conversationId: ctx.conversationId ?? "default",
          parentRunId: ctx.parentRunId,
          settings: ctx.settings,
          permissions: ctx.permissions ?? { mode: "workspace-write", policy: "ask" },
          workspaceId: ctx.workspaceId,
          cwd: ctx.cwd,
        })
      : {}),
    ...(ctx.settings
      ? buildTeamTools({
          conversationId: ctx.conversationId ?? "default",
          parentRunId: ctx.parentRunId,
          settings: ctx.settings,
          permissions: ctx.permissions ?? { mode: "workspace-write", policy: "ask" },
          workspaceId: ctx.workspaceId,
        })
      : {}),
    ...(ctx.settings
      ? buildWorkflowTools({
          conversationId: ctx.conversationId ?? "default",
          parentRunId: ctx.parentRunId,
          settings: ctx.settings,
          permissions: ctx.permissions ?? { mode: "workspace-write", policy: "ask" },
          workspaceId: ctx.workspaceId,
          cwd: ctx.cwd,
        })
      : {}),
    ...buildSkillTools(),
    ...buildLspTools({ cwd: ctx.cwd }),
    ...buildBrowserTools(),
    ...buildDeliverableTools(ctx.conversationId),
    ...buildInspectTools(),
    ...buildPluginTools(),
    ...buildWorktreeTools({ sessionDir: ctx.sessionDir }),
    ...buildPowershellTools({ sessionDir: ctx.sessionDir, sessionId: ctx.conversationId }),
    ...buildMCPResourceTools(),
  };
}
