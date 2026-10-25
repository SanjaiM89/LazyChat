/**
 * The tool catalog: what every tool is, in one place.
 *
 * This module is pure data with no imports, so the server (which enforces
 * policy against it) and the browser (which renders the tool cards from it)
 * read the same description of a tool. A tool that is not listed here still
 * runs — it simply falls back to the generic "others" presentation and the
 * most conservative policy.
 *
 * `effect` is the axis the permission layer decides on:
 *   read     — observes, changes nothing
 *   network  — reaches the network, changes nothing local
 *   write    — changes durable state (a file, the store, the graph)
 *   exec     — runs a command on the host
 *   spawn    — starts a long-lived process or agent
 */
export type ToolEffect = "read" | "network" | "write" | "exec" | "spawn";

export type ToolFamily =
  | "workspace"
  | "shell"
  | "code"
  | "web"
  | "browser"
  | "artifact"
  | "document"
  | "memory"
  | "task"
  | "team"
  | "workflow"
  | "subagent"
  | "jobs"
  | "session"
  | "interaction"
  | "ui"
  | "mcp"
  | "sandbox";

export type ToolVariant = "search" | "read" | "bash" | "write" | "edit" | "code" | "others";

export interface ToolMeta {
  name: string;
  family: ToolFamily;
  /** Human label for the tool card. */
  title: string;
  /** Which glyph and colour the card uses. */
  variant: ToolVariant;
  effect: ToolEffect;
  /** Safe to run alongside its siblings in the same step. */
  concurrencySafe: boolean;
  /** Changes durable state. */
  mutates: boolean;
}

function meta(
  name: string,
  family: ToolFamily,
  title: string,
  variant: ToolVariant,
  effect: ToolEffect,
  concurrencySafe: boolean,
  mutates: boolean,
): ToolMeta {
  return { name, family, title, variant, effect, concurrencySafe, mutates };
}

/** Every tool Omnia knows about, keyed by the name the model calls. */
export const TOOL_CATALOG: Record<string, ToolMeta> = {
  // --- Workspace (folder-bound) -------------------------------------------
  ws_list: meta("ws_list", "workspace", "List files", "read", "read", true, false),
  ws_read: meta("ws_read", "workspace", "Read file", "read", "read", true, false),
  ws_glob: meta("ws_glob", "workspace", "Find files", "search", "read", true, false),
  ws_grep: meta("ws_grep", "workspace", "Search files", "search", "read", true, false),
  ws_read_image: meta("ws_read_image", "workspace", "Read image", "read", "read", true, false),
  ws_write: meta("ws_write", "workspace", "Write file", "write", "write", false, true),
  ws_str_replace_editor: meta("ws_str_replace_editor", "workspace", "Edit file", "edit", "write", false, true),
  ws_shell: meta("ws_shell", "shell", "Run command", "bash", "exec", false, true),
  ws_todo: meta("ws_todo", "task", "Todo", "others", "write", false, true),
  ws_remember: meta("ws_remember", "memory", "Remember", "others", "write", false, true),

  // --- Web and browser -----------------------------------------------------
  web_search: meta("web_search", "web", "Search the web", "search", "network", true, false),
  computer_search: meta("computer_search", "browser", "Search the web", "search", "network", false, false),
  computer_navigate: meta("computer_navigate", "browser", "Open page", "read", "network", false, false),
  computer_nav: meta("computer_nav", "browser", "Browser history", "others", "network", false, false),
  computer_click: meta("computer_click", "browser", "Click", "others", "network", false, false),
  computer_type: meta("computer_type", "browser", "Type", "others", "network", false, false),
  computer_press: meta("computer_press", "browser", "Press key", "others", "network", false, false),
  computer_read: meta("computer_read", "browser", "Read page", "read", "network", true, false),
  computer_screenshot: meta("computer_screenshot", "browser", "Screenshot", "read", "network", true, false),
  browser_observe: meta("browser_observe", "browser", "Observe the page", "read", "network", true, false),
  browser_extract: meta("browser_extract", "browser", "Extract values", "read", "network", true, false),
  browser_tabs: meta("browser_tabs", "browser", "Work with tabs", "others", "network", false, false),

  // --- Artifacts and documents --------------------------------------------
  createArtifact: meta("createArtifact", "artifact", "Create artifact", "write", "write", false, true),
  generate_document: meta("generate_document", "document", "Generate document", "write", "write", false, true),

  // --- Memory (Company Brain) ---------------------------------------------
  companyBrain: meta("companyBrain", "memory", "Company Brain", "others", "read", true, false),
  find_experts: meta("find_experts", "memory", "Find experts", "others", "read", true, false),
  trace_dependencies: meta("trace_dependencies", "memory", "Trace dependencies", "others", "read", true, false),
  impact_of_failure: meta("impact_of_failure", "memory", "Blast radius", "others", "read", true, false),
  get_decision_context: meta("get_decision_context", "memory", "Decision context", "read", "read", true, false),
  tickets_blocked_by: meta("tickets_blocked_by", "memory", "Blocked tickets", "others", "read", true, false),
  tickets_for_service: meta("tickets_for_service", "memory", "Service tickets", "search", "read", true, false),
  find_people: meta("find_people", "memory", "Find people", "search", "read", true, false),
  shortest_path: meta("shortest_path", "memory", "Shortest path", "others", "read", true, false),
  pagerank: meta("pagerank", "memory", "PageRank", "others", "read", true, false),
  bridge_services: meta("bridge_services", "memory", "Bridges", "others", "read", true, false),
  find_bottlenecks: meta("find_bottlenecks", "memory", "Bottlenecks", "others", "read", true, false),
  central_services: meta("central_services", "memory", "Central services", "others", "read", true, false),
  team_clusters: meta("team_clusters", "memory", "Team clusters", "others", "read", true, false),
  graph_context: meta("graph_context", "memory", "Graph context", "read", "read", true, false),
  run_cypher: meta("run_cypher", "memory", "Run Cypher", "code", "read", true, false),
  create_ticket: meta("create_ticket", "memory", "Create ticket", "write", "write", false, true),
  update_ticket: meta("update_ticket", "memory", "Update ticket", "edit", "write", false, true),
  record_decision: meta("record_decision", "memory", "Record decision", "write", "write", false, true),
  note_knowledge: meta("note_knowledge", "memory", "Note expertise", "write", "write", false, true),
  remember_fact: meta("remember_fact", "memory", "Remember fact", "write", "write", false, true),

  // --- Task control --------------------------------------------------------
  todo_write: meta("todo_write", "task", "Update tasks", "others", "read", true, false),
  create_goal: meta("create_goal", "task", "Set a goal", "others", "write", false, true),
  get_goal: meta("get_goal", "task", "Check goal", "read", "read", true, false),
  update_goal: meta("update_goal", "task", "Update goal", "others", "write", false, true),
  schedule_create: meta("schedule_create", "task", "Schedule reminder", "others", "write", false, true),
  schedule_list: meta("schedule_list", "task", "List reminders", "read", "read", true, false),
  schedule_update: meta("schedule_update", "task", "Update reminder", "others", "write", false, true),
  schedule_delete: meta("schedule_delete", "task", "Delete reminder", "others", "write", false, true),
  exit_plan_mode: meta("exit_plan_mode", "task", "Submit plan", "others", "write", false, true),

  // --- History -------------------------------------------------------------
  session_search: meta("session_search", "session", "Search conversations", "search", "read", true, false),
  session_event_read: meta("session_event_read", "session", "Read history", "read", "read", true, false),

  // --- Interaction ---------------------------------------------------------
  ask_user_question: meta("ask_user_question", "interaction", "Ask the user", "others", "read", false, false),

  // --- Generative UI -------------------------------------------------------
  render_ui: meta("render_ui", "ui", "Render UI", "write", "write", false, true),
  search_ui_components: meta("search_ui_components", "ui", "Find components", "search", "read", true, false),

  // --- Sandbox agents ------------------------------------------------------
  runAgentTask: meta("runAgentTask", "sandbox", "Run agent", "others", "spawn", false, true),

  // --- Shell ---------------------------------------------------------------
  shell_bash: meta("shell_bash", "shell", "Run command", "bash", "exec", false, true),
  pwsh: meta("pwsh", "shell", "Run PowerShell", "bash", "exec", false, true),
  pwsh_persistent: meta("pwsh_persistent", "shell", "Open PowerShell", "bash", "exec", false, true),
  pwsh_run: meta("pwsh_run", "shell", "Run in PowerShell", "bash", "exec", false, true),
  working_directory: meta("working_directory", "shell", "Working directory", "read", "read", true, false),
  terminal_open: meta("terminal_open", "shell", "Open terminal", "bash", "exec", false, true),
  terminal_send: meta("terminal_send", "shell", "Send to terminal", "bash", "exec", false, true),
  terminal_read: meta("terminal_read", "shell", "Read terminal", "read", "read", true, false),
  terminal_signal: meta("terminal_signal", "shell", "Signal terminal", "others", "exec", false, true),
  terminal_close: meta("terminal_close", "shell", "Close terminal", "others", "exec", false, true),
  terminal_list: meta("terminal_list", "shell", "List terminals", "search", "read", true, false),

  // --- Context -------------------------------------------------------------
  spill_read: meta("spill_read", "task", "Read a spilled result", "read", "read", true, false),

  // --- Attachments ---------------------------------------------------------
  attachment_list: meta("attachment_list", "task", "List attachments", "search", "read", true, false),
  attachment_read: meta("attachment_read", "task", "Read an attachment", "read", "read", true, false),

  // --- Workflow ------------------------------------------------------------
  workflow: meta("workflow", "workflow", "Run a workflow", "code", "spawn", false, true),
  ralph: meta("ralph", "workflow", "Iterate to an objective", "others", "spawn", false, true),

  // --- Teams ---------------------------------------------------------------
  team_spawn_teammate: meta("team_spawn_teammate", "team", "Spawn a teammate", "others", "spawn", false, true),
  team_send_message: meta("team_send_message", "team", "Message a teammate", "others", "write", false, true),
  team_list_agents: meta("team_list_agents", "team", "List the team", "search", "read", true, false),
  team_wait_agent: meta("team_wait_agent", "team", "Wait for the team", "others", "read", true, false),
  team_interrupt_agent: meta("team_interrupt_agent", "team", "Stop a teammate", "others", "write", false, true),
  team_task_create: meta("team_task_create", "team", "Create a task", "write", "write", false, true),
  team_task_list: meta("team_task_list", "team", "List tasks", "search", "read", true, false),
  team_task_get: meta("team_task_get", "team", "Read a task", "read", "read", true, false),
  team_task_update: meta("team_task_update", "team", "Change a task", "edit", "write", false, true),

  // --- Subagents and jobs --------------------------------------------------
  subagent: meta("subagent", "subagent", "Run a subagent", "others", "spawn", false, true),
  subagent_list: meta("subagent_list", "subagent", "List subagents", "search", "read", true, false),
  subagent_send_message: meta("subagent_send_message", "subagent", "Message a subagent", "others", "write", false, true),
  subagent_interrupt: meta("subagent_interrupt", "subagent", "Stop a subagent", "others", "write", false, true),
  subagent_list_models: meta("subagent_list_models", "subagent", "List models", "search", "read", true, false),
  job_start: meta("job_start", "jobs", "Start a background job", "bash", "exec", false, true),
  job_output: meta("job_output", "jobs", "Read a job's output", "read", "read", true, false),
  job_list: meta("job_list", "jobs", "List jobs", "search", "read", true, false),
  job_kill: meta("job_kill", "jobs", "Stop a job", "others", "exec", false, true),

  // --- Code ----------------------------------------------------------------
  code_run: meta("code_run", "code", "Run a program", "code", "exec", false, true),
  lsp: meta("lsp", "code", "Ask a language server", "read", "read", true, false),
  lsp_servers: meta("lsp_servers", "code", "Configure language servers", "others", "write", false, true),

  // --- Registry and history ------------------------------------------------
  web_fetch: meta("web_fetch", "web", "Fetch page", "read", "network", true, false),
  session_stats: meta("session_stats", "session", "Session stats", "read", "read", true, false),
  session_outline: meta("session_outline", "session", "Session outline", "read", "read", true, false),
  session_title: meta("session_title", "session", "Session title", "read", "read", true, false),
  session_export: meta("session_export", "session", "Session export", "read", "read", true, false),
  session_event_search: meta("session_event_search", "session", "Search the log", "search", "read", true, false),
  session_trace: meta("session_trace", "session", "Trace a run", "read", "read", true, false),
  session_event_trace: meta("session_event_trace", "session", "Trace an event", "read", "read", true, false),
  create_worktree: meta("create_worktree", "workspace", "Create a worktree", "others", "write", false, true),
  list_worktrees: meta("list_worktrees", "workspace", "List worktrees", "read", "read", true, false),
  load_workspace_dependencies: meta(
    "load_workspace_dependencies",
    "workspace",
    "Runtime paths",
    "others",
    "read",
    true,
    false,
  ),
  skill: meta("skill", "task", "Load skill", "others", "read", true, false),
  present: meta("present", "task", "Present result", "others", "write", false, true),
  inspect_list: meta("inspect_list", "task", "List tools", "search", "read", true, false),
  inspect_query: meta("inspect_query", "task", "Inspect a tool", "read", "read", true, false),
  plugin_list: meta("plugin_list", "task", "List plugins", "search", "read", true, false),
  plugin_set: meta("plugin_set", "task", "Switch a plugin", "others", "write", false, true),
  plugin_bundle_set: meta("plugin_bundle_set", "task", "Switch a bundle", "others", "write", false, true),
  plugin_exemption_list: meta("plugin_exemption_list", "task", "List version pins", "search", "read", true, false),
  plugin_exemption_set: meta("plugin_exemption_set", "task", "Pin a plugin version", "others", "write", false, true),
  mcp_list_resources: meta("mcp_list_resources", "mcp", "List resources", "search", "read", true, false),
  mcp_list_resource_templates: meta("mcp_list_resource_templates", "mcp", "List resource templates", "search", "read", true, false),
  mcp_read_resource: meta("mcp_read_resource", "mcp", "Read a resource", "read", "read", true, false),
};

/** The description of a tool, or undefined when the catalog does not know it. */
export function toolMeta(name: string): ToolMeta | undefined {
  return TOOL_CATALOG[name];
}

/** The effect of a tool; unknown tools are treated as writes — the safe side. */
export function toolEffect(name: string): ToolEffect {
  return TOOL_CATALOG[name]?.effect ?? "write";
}

/** Whether a tool may run alongside its siblings in one step. */
export function toolConcurrencySafe(name: string): boolean {
  return TOOL_CATALOG[name]?.concurrencySafe ?? false;
}
