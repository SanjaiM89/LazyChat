from __future__ import annotations

from dataclasses import dataclass

ToolEffect = str
ToolFamily = str
ToolVariant = str

@dataclass
class ToolMeta:
    name: str
    family: ToolFamily
    title: str
    variant: ToolVariant
    effect: ToolEffect
    concurrency_safe: bool
    mutates: bool

TOOL_CATALOG: dict[str, ToolMeta] = {
    "ws_list": ToolMeta(name="ws_list", family="workspace", title="List files", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "ws_read": ToolMeta(name="ws_read", family="workspace", title="Read file", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "ws_glob": ToolMeta(name="ws_glob", family="workspace", title="Find files", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "ws_grep": ToolMeta(name="ws_grep", family="workspace", title="Search files", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "ws_read_image": ToolMeta(name="ws_read_image", family="workspace", title="Read image", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "ws_write": ToolMeta(name="ws_write", family="workspace", title="Write file", variant="write", effect="write", concurrency_safe=False, mutates=True),
    "ws_str_replace_editor": ToolMeta(name="ws_str_replace_editor", family="workspace", title="Edit file", variant="edit", effect="write", concurrency_safe=False, mutates=True),
    "ws_shell": ToolMeta(name="ws_shell", family="shell", title="Run command", variant="bash", effect="exec", concurrency_safe=False, mutates=True),
    "ws_todo": ToolMeta(name="ws_todo", family="task", title="Todo", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "ws_remember": ToolMeta(name="ws_remember", family="memory", title="Remember", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "web_search": ToolMeta(name="web_search", family="web", title="Search the web", variant="search", effect="network", concurrency_safe=True, mutates=False),
    "computer_search": ToolMeta(name="computer_search", family="browser", title="Search the web", variant="search", effect="network", concurrency_safe=False, mutates=False),
    "computer_navigate": ToolMeta(name="computer_navigate", family="browser", title="Open page", variant="read", effect="network", concurrency_safe=False, mutates=False),
    "computer_nav": ToolMeta(name="computer_nav", family="browser", title="Browser history", variant="others", effect="network", concurrency_safe=False, mutates=False),
    "computer_click": ToolMeta(name="computer_click", family="browser", title="Click", variant="others", effect="network", concurrency_safe=False, mutates=False),
    "computer_type": ToolMeta(name="computer_type", family="browser", title="Type", variant="others", effect="network", concurrency_safe=False, mutates=False),
    "computer_press": ToolMeta(name="computer_press", family="browser", title="Press key", variant="others", effect="network", concurrency_safe=False, mutates=False),
    "computer_read": ToolMeta(name="computer_read", family="browser", title="Read page", variant="read", effect="network", concurrency_safe=True, mutates=False),
    "computer_screenshot": ToolMeta(name="computer_screenshot", family="browser", title="Screenshot", variant="read", effect="network", concurrency_safe=True, mutates=False),
    "browser_observe": ToolMeta(name="browser_observe", family="browser", title="Observe the page", variant="read", effect="network", concurrency_safe=True, mutates=False),
    "browser_extract": ToolMeta(name="browser_extract", family="browser", title="Extract values", variant="read", effect="network", concurrency_safe=True, mutates=False),
    "browser_tabs": ToolMeta(name="browser_tabs", family="browser", title="Work with tabs", variant="others", effect="network", concurrency_safe=False, mutates=False),
    "createArtifact": ToolMeta(name="createArtifact", family="artifact", title="Create artifact", variant="write", effect="write", concurrency_safe=False, mutates=True),
    "generate_document": ToolMeta(name="generate_document", family="document", title="Generate document", variant="write", effect="write", concurrency_safe=False, mutates=True),
    "companyBrain": ToolMeta(name="companyBrain", family="memory", title="Company Brain", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "find_experts": ToolMeta(name="find_experts", family="memory", title="Find experts", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "trace_dependencies": ToolMeta(name="trace_dependencies", family="memory", title="Trace dependencies", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "impact_of_failure": ToolMeta(name="impact_of_failure", family="memory", title="Blast radius", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "get_decision_context": ToolMeta(name="get_decision_context", family="memory", title="Decision context", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "tickets_blocked_by": ToolMeta(name="tickets_blocked_by", family="memory", title="Blocked tickets", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "tickets_for_service": ToolMeta(name="tickets_for_service", family="memory", title="Service tickets", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "find_people": ToolMeta(name="find_people", family="memory", title="Find people", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "shortest_path": ToolMeta(name="shortest_path", family="memory", title="Shortest path", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "pagerank": ToolMeta(name="pagerank", family="memory", title="PageRank", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "bridge_services": ToolMeta(name="bridge_services", family="memory", title="Bridges", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "find_bottlenecks": ToolMeta(name="find_bottlenecks", family="memory", title="Bottlenecks", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "central_services": ToolMeta(name="central_services", family="memory", title="Central services", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "team_clusters": ToolMeta(name="team_clusters", family="memory", title="Team clusters", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "graph_context": ToolMeta(name="graph_context", family="memory", title="Graph context", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "run_cypher": ToolMeta(name="run_cypher", family="memory", title="Run Cypher", variant="code", effect="read", concurrency_safe=True, mutates=False),
    "create_ticket": ToolMeta(name="create_ticket", family="memory", title="Create ticket", variant="write", effect="write", concurrency_safe=False, mutates=True),
    "update_ticket": ToolMeta(name="update_ticket", family="memory", title="Update ticket", variant="edit", effect="write", concurrency_safe=False, mutates=True),
    "record_decision": ToolMeta(name="record_decision", family="memory", title="Record decision", variant="write", effect="write", concurrency_safe=False, mutates=True),
    "note_knowledge": ToolMeta(name="note_knowledge", family="memory", title="Note expertise", variant="write", effect="write", concurrency_safe=False, mutates=True),
    "remember_fact": ToolMeta(name="remember_fact", family="memory", title="Remember fact", variant="write", effect="write", concurrency_safe=False, mutates=True),
    "todo_write": ToolMeta(name="todo_write", family="task", title="Update tasks", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "create_goal": ToolMeta(name="create_goal", family="task", title="Set a goal", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "get_goal": ToolMeta(name="get_goal", family="task", title="Check goal", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "update_goal": ToolMeta(name="update_goal", family="task", title="Update goal", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "schedule_create": ToolMeta(name="schedule_create", family="task", title="Schedule reminder", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "schedule_list": ToolMeta(name="schedule_list", family="task", title="List reminders", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "schedule_update": ToolMeta(name="schedule_update", family="task", title="Update reminder", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "schedule_delete": ToolMeta(name="schedule_delete", family="task", title="Delete reminder", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "exit_plan_mode": ToolMeta(name="exit_plan_mode", family="task", title="Submit plan", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "session_search": ToolMeta(name="session_search", family="session", title="Search conversations", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "session_event_read": ToolMeta(name="session_event_read", family="session", title="Read history", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "ask_user_question": ToolMeta(name="ask_user_question", family="interaction", title="Ask the user", variant="others", effect="read", concurrency_safe=False, mutates=False),
    "render_ui": ToolMeta(name="render_ui", family="ui", title="Render UI", variant="write", effect="write", concurrency_safe=False, mutates=True),
    "search_ui_components": ToolMeta(name="search_ui_components", family="ui", title="Find components", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "runAgentTask": ToolMeta(name="runAgentTask", family="sandbox", title="Run agent", variant="others", effect="spawn", concurrency_safe=False, mutates=True),
    "shell_bash": ToolMeta(name="shell_bash", family="shell", title="Run command", variant="bash", effect="exec", concurrency_safe=False, mutates=True),
    "pwsh": ToolMeta(name="pwsh", family="shell", title="Run PowerShell", variant="bash", effect="exec", concurrency_safe=False, mutates=True),
    "pwsh_persistent": ToolMeta(name="pwsh_persistent", family="shell", title="Open PowerShell", variant="bash", effect="exec", concurrency_safe=False, mutates=True),
    "pwsh_run": ToolMeta(name="pwsh_run", family="shell", title="Run in PowerShell", variant="bash", effect="exec", concurrency_safe=False, mutates=True),
    "working_directory": ToolMeta(name="working_directory", family="shell", title="Working directory", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "terminal_open": ToolMeta(name="terminal_open", family="shell", title="Open terminal", variant="bash", effect="exec", concurrency_safe=False, mutates=True),
    "terminal_send": ToolMeta(name="terminal_send", family="shell", title="Send to terminal", variant="bash", effect="exec", concurrency_safe=False, mutates=True),
    "terminal_read": ToolMeta(name="terminal_read", family="shell", title="Read terminal", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "terminal_signal": ToolMeta(name="terminal_signal", family="shell", title="Signal terminal", variant="others", effect="exec", concurrency_safe=False, mutates=True),
    "terminal_close": ToolMeta(name="terminal_close", family="shell", title="Close terminal", variant="others", effect="exec", concurrency_safe=False, mutates=True),
    "terminal_list": ToolMeta(name="terminal_list", family="shell", title="List terminals", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "spill_read": ToolMeta(name="spill_read", family="task", title="Read a spilled result", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "attachment_list": ToolMeta(name="attachment_list", family="task", title="List attachments", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "attachment_read": ToolMeta(name="attachment_read", family="task", title="Read an attachment", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "workflow": ToolMeta(name="workflow", family="workflow", title="Run a workflow", variant="code", effect="spawn", concurrency_safe=False, mutates=True),
    "ralph": ToolMeta(name="ralph", family="workflow", title="Iterate to an objective", variant="others", effect="spawn", concurrency_safe=False, mutates=True),
    "team_spawn_teammate": ToolMeta(name="team_spawn_teammate", family="team", title="Spawn a teammate", variant="others", effect="spawn", concurrency_safe=False, mutates=True),
    "team_send_message": ToolMeta(name="team_send_message", family="team", title="Message a teammate", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "team_list_agents": ToolMeta(name="team_list_agents", family="team", title="List the team", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "team_wait_agent": ToolMeta(name="team_wait_agent", family="team", title="Wait for the team", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "team_interrupt_agent": ToolMeta(name="team_interrupt_agent", family="team", title="Stop a teammate", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "team_task_create": ToolMeta(name="team_task_create", family="team", title="Create a task", variant="write", effect="write", concurrency_safe=False, mutates=True),
    "team_task_list": ToolMeta(name="team_task_list", family="team", title="List tasks", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "team_task_get": ToolMeta(name="team_task_get", family="team", title="Read a task", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "team_task_update": ToolMeta(name="team_task_update", family="team", title="Change a task", variant="edit", effect="write", concurrency_safe=False, mutates=True),
    "subagent": ToolMeta(name="subagent", family="subagent", title="Run a subagent", variant="others", effect="spawn", concurrency_safe=False, mutates=True),
    "subagent_list": ToolMeta(name="subagent_list", family="subagent", title="List subagents", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "subagent_send_message": ToolMeta(name="subagent_send_message", family="subagent", title="Message a subagent", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "subagent_interrupt": ToolMeta(name="subagent_interrupt", family="subagent", title="Stop a subagent", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "subagent_list_models": ToolMeta(name="subagent_list_models", family="subagent", title="List models", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "job_start": ToolMeta(name="job_start", family="jobs", title="Start a background job", variant="bash", effect="exec", concurrency_safe=False, mutates=True),
    "job_output": ToolMeta(name="job_output", family="jobs", title="Read a job's output", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "job_list": ToolMeta(name="job_list", family="jobs", title="List jobs", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "job_kill": ToolMeta(name="job_kill", family="jobs", title="Stop a job", variant="others", effect="exec", concurrency_safe=False, mutates=True),
    "code_run": ToolMeta(name="code_run", family="code", title="Run a program", variant="code", effect="exec", concurrency_safe=False, mutates=True),
    "lsp": ToolMeta(name="lsp", family="code", title="Ask a language server", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "lsp_servers": ToolMeta(name="lsp_servers", family="code", title="Configure language servers", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "web_fetch": ToolMeta(name="web_fetch", family="web", title="Fetch page", variant="read", effect="network", concurrency_safe=True, mutates=False),
    "session_stats": ToolMeta(name="session_stats", family="session", title="Session stats", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "session_outline": ToolMeta(name="session_outline", family="session", title="Session outline", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "session_title": ToolMeta(name="session_title", family="session", title="Session title", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "session_export": ToolMeta(name="session_export", family="session", title="Session export", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "session_event_search": ToolMeta(name="session_event_search", family="session", title="Search the log", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "session_trace": ToolMeta(name="session_trace", family="session", title="Trace a run", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "session_event_trace": ToolMeta(name="session_event_trace", family="session", title="Trace an event", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "create_worktree": ToolMeta(name="create_worktree", family="workspace", title="Create a worktree", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "list_worktrees": ToolMeta(name="list_worktrees", family="workspace", title="List worktrees", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "skill": ToolMeta(name="skill", family="task", title="Load skill", variant="others", effect="read", concurrency_safe=True, mutates=False),
    "present": ToolMeta(name="present", family="task", title="Present result", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "inspect_list": ToolMeta(name="inspect_list", family="task", title="List tools", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "inspect_query": ToolMeta(name="inspect_query", family="task", title="Inspect a tool", variant="read", effect="read", concurrency_safe=True, mutates=False),
    "plugin_list": ToolMeta(name="plugin_list", family="task", title="List plugins", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "plugin_set": ToolMeta(name="plugin_set", family="task", title="Switch a plugin", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "plugin_bundle_set": ToolMeta(name="plugin_bundle_set", family="task", title="Switch a bundle", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "plugin_exemption_list": ToolMeta(name="plugin_exemption_list", family="task", title="List version pins", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "plugin_exemption_set": ToolMeta(name="plugin_exemption_set", family="task", title="Pin a plugin version", variant="others", effect="write", concurrency_safe=False, mutates=True),
    "mcp_list_resources": ToolMeta(name="mcp_list_resources", family="mcp", title="List resources", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "mcp_list_resource_templates": ToolMeta(name="mcp_list_resource_templates", family="mcp", title="List resource templates", variant="search", effect="read", concurrency_safe=True, mutates=False),
    "mcp_read_resource": ToolMeta(name="mcp_read_resource", family="mcp", title="Read a resource", variant="read", effect="read", concurrency_safe=True, mutates=False),
}

def tool_meta(name: str) -> ToolMeta | None:
    return TOOL_CATALOG.get(name)

def tool_effect(name: str) -> str:
    return (TOOL_CATALOG.get(name).effect if TOOL_CATALOG.get(name) else "write")

def tool_concurrency_safe(name: str) -> bool:
    m = TOOL_CATALOG.get(name)
    return m.concurrency_safe if m else False