from __future__ import annotations

import json
import os
from typing import Any

DATA_DIR = os.getenv("DATA_DIR", "./data")
FILE = "plugins.json"

BUILTIN_PLUGINS = [
    {"id": "web", "title": "Web", "description": "Search the web and fetch pages.", "tools": ['web_search', 'web_fetch'], "version": "1.0.0"},
    {"id": "browser", "title": "Browser", "description": "Drive the shared Chromium browser.", "tools": ['computer_search', 'computer_navigate', 'computer_nav', 'computer_click', 'computer_type', 'computer_press', 'computer_read', 'computer_screenshot', 'browser_observe', 'browser_extract', 'browser_tabs'], "version": "1.0.0"},
    {"id": "artifacts", "title": "Artifacts", "description": "Create rich artifacts and real documents.", "tools": ['createArtifact', 'generate_document'], "version": "1.0.0"},
    {"id": "brain", "title": "Company Brain", "description": "Query and act on the knowledge graph.", "tools": ['companyBrain', 'find_experts', 'trace_dependencies', 'impact_of_failure', 'get_decision_context', 'tickets_blocked_by', 'tickets_for_service', 'find_people', 'shortest_path', 'pagerank', 'bridge_services', 'find_bottlenecks', 'central_services', 'team_clusters', 'graph_context', 'run_cypher', 'create_ticket', 'update_ticket', 'record_decision', 'note_knowledge', 'remember_fact'], "version": "1.0.0"},
    {"id": "workspace", "title": "Workspace", "description": "Read and change the files of an attached folder.", "tools": ['ws_list', 'ws_read', 'ws_glob', 'ws_grep', 'create_worktree', 'list_worktrees', 'load_workspace_dependencies', 'ws_read_image', 'ws_write', 'ws_str_replace_editor', 'ws_shell', 'ws_todo', 'ws_remember'], "version": "1.0.0"},
    {"id": "tasks", "title": "Tasks", "description": "Goals, reminders, plan mode and skills.", "tools": ['todo_write', 'create_goal', 'get_goal', 'update_goal', 'schedule_create', 'schedule_list', 'schedule_update', 'schedule_delete', 'exit_plan_mode', 'skill', 'present', 'spill_read', 'attachment_list', 'attachment_read'], "version": "1.0.0"},
    {"id": "history", "title": "History", "description": "Search and read earlier conversations and runs.", "tools": ['session_search', 'session_event_read', 'session_event_search', 'session_trace', 'session_stats', 'session_outline', 'session_title', 'session_export', 'session_event_trace'], "version": "1.0.0"},
    {"id": "ui", "title": "Generative UI", "description": "Render interfaces inside the chat.", "tools": ['render_ui', 'search_ui_components'], "version": "1.0.0"},
    {"id": "agents", "title": "Sandbox agents", "description": "Run an agent in an isolated local sandbox.", "tools": ['runAgentTask'], "version": "1.0.0"},
    {"id": "shell", "title": "Shell", "description": "Run commands in a shell that stays alive.", "tools": ['shell_bash', 'working_directory', 'pwsh', 'pwsh_persistent', 'pwsh_run', 'terminal_open', 'terminal_send', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list'], "version": "1.0.0"},
    {"id": "code", "title": "Programs", "description": "Run a program that calls the agent's tools, and ask a language server about the code.", "tools": ['code_run', 'lsp', 'lsp_servers'], "version": "1.0.0"},
    {"id": "workflow", "title": "Workflows", "description": "Run a program that fans work out across many agents.", "tools": ['workflow', 'ralph'], "version": "1.0.0"},
    {"id": "teams", "title": "Teams", "description": "Named teammates working a shared task board.", "tools": ['team_spawn_teammate', 'team_send_message', 'team_list_agents', 'team_wait_agent', 'team_interrupt_agent', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update'], "version": "1.0.0"},
    {"id": "subagents", "title": "Subagents", "description": "Hand work to a second agent that reports back.", "tools": ['subagent', 'subagent_list', 'subagent_send_message', 'subagent_interrupt', 'subagent_list_models'], "version": "1.0.0"},
    {"id": "jobs", "title": "Background jobs", "description": "Run commands that keep going after the turn ends.", "tools": ['job_start', 'job_output', 'job_list', 'job_kill'], "version": "1.0.0"},
    {"id": "interaction", "title": "Interaction", "description": "Ask the user a question mid-turn.", "tools": ['ask_user_question'], "version": "1.0.0"},
    {"id": "mcp", "title": "MCP resources", "description": "Read the resources an MCP server offers.", "tools": ['mcp_list_resources', 'mcp_list_resource_templates', 'mcp_read_resource'], "version": "1.0.0"},
    {"id": "registry", "title": "Registry", "description": "Inspect the tool registry and switch plugins on or off.", "tools": ['inspect_list', 'inspect_query', 'plugin_list', 'plugin_set', 'plugin_bundle_set', 'plugin_exemption_list', 'plugin_exemption_set'], "version": "1.0.0"},
]

BUILTIN_BUNDLES = {
    "writing": {"title": "Writing", "description": "Everything needed to write and publish a document.", "plugins": ["web", "artifacts", "ui"]},
    "engineering": {"title": "Engineering", "description": "Work on a codebase with history and agents.", "plugins": ["workspace", "history", "agents", "brain"]},
    "research": {"title": "Research", "description": "Search, browse and read.", "plugins": ["web", "browser", "history"]},
}


def _path():
    return os.path.join(DATA_DIR, FILE)


def read_plugin_state() -> dict[str, Any]:
    if not os.path.exists(_path()):
        return {"enabled": {}, "bundles": {}, "exemptions": {}}
    try:
        with open(_path()) as f:
            stored = json.load(f)
    except Exception:
        stored = {}
    return {"enabled": dict(stored.get("enabled", {})), "bundles": dict(stored.get("bundles", {})), "exemptions": dict(stored.get("exemptions", {}))}


def write_plugin_state(state: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(_path()) or ".", exist_ok=True)
    with open(_path(), "w") as f:
        json.dump(state, f, indent=2)


def is_plugin_enabled(state: dict[str, Any], pid: str) -> bool:
    return state.get("enabled", {}).get(pid, True) is not False


def disabled_tool_names(state: dict[str, Any]) -> set[str]:
    out = set()
    for plugin in BUILTIN_PLUGINS:
        if is_plugin_enabled(state, plugin["id"]):
            continue
        for t in plugin["tools"]:
            out.add(t)
    return out


def enabled_tool_names(state: dict[str, Any]) -> set[str]:
    names = set()
    for plugin in BUILTIN_PLUGINS:
        if not is_plugin_enabled(state, plugin["id"]):
            continue
        for t in plugin["tools"]:
            names.add(t)
    return names


def unclaimed_tools() -> list[str]:
    claimed = set()
    for p in BUILTIN_PLUGINS:
        for t in p["tools"]:
            claimed.add(t)
    from .catalog import TOOL_CATALOG
    return [name for name in TOOL_CATALOG if name not in claimed]
