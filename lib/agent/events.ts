/**
 * The durable event vocabulary.
 *
 * Every fact about a conversation that has to outlive the request is appended
 * to the session log: turns, steps, tool calls and their results, approvals,
 * compactions, goals, jobs, subagents. The log is the source of truth for
 * history — the conversation row keeps metadata only.
 *
 * The names follow the shape `subject/verb` so a reader can tell a request
 * from an outcome, and a state change from a record.
 */
export const EVENT_TYPES = [
  // Conversation
  "user/message",
  "assistant/message",
  "assistant/attempt",
  "session/title",

  // Turn and step boundaries
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",

  // Tools
  "tool/call",
  "tool/result",
  "tool/change",

  // Human interaction
  "approval/asked",
  "approval/decided",
  "ask-user/answered",

  // Policy
  "permission/preset",
  "sandbox/mode",
  "plan/mode",
  "working-directory/change",
  // Context management
  "compaction/start",
  "compaction/summary",
  "compaction/end",
  "spill",
  "workspace/changes",
  "image/offload",

  // Work units
  "goal/change",
  "goal/round",
  "todo/write",
  "job/start",
  "job/end",
  "schedule/change",
  "subagent/started",
  "subagent/finished",
  "team/member",
  "team/task",
  "tool-workflow/run-start",
  "tool-workflow/agent-start",
  "tool-workflow/agent-end",
  "tool-workflow/run-end",

  // Model and feedback
  "model/selection",
  "deliverables/presented",
  "feedback/record",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

export function isEventType(value: string): value is EventType {
  return EVENT_TYPE_SET.has(value);
}

/** Events that describe a request or an outcome, not an internal state change. */
export const OUTCOME_EVENT_TYPES: readonly EventType[] = [
  "user/message",
  "assistant/message",
  "tool/call",
  "tool/result",
  "approval/decided",
  "compaction/end",
  "job/end",
  "subagent/finished",
  "turn/end",
];
