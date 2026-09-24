# Omnia Desktop (Qt 6)

Standalone C++/Qt port of the Omnia (LazyChat) web app.

## Features

- Multi-provider chat (OpenAI / Anthropic / Gemini protocols + custom providers) with streaming, thinking, and a tool loop
- Tools: web search, artifacts, sandbox agent (`runAgentTask`), computer use (Chromium)
- Chromium computer panel: live screenshots, URL bar (URL or search), take/release control, fullscreen, timeline filmstrip
- Agent sandboxes: Docker (`omnia-sandbox:latest`) spawn/start/kill/exec, event receiver
- Artifacts panel: markdown, code, HTML, PDF, images, SVG, CSV viewers
- Subchat, skills, MCP connections (stdio + HTTP), search providers, API keys, display settings, manage models
- Shares the web app `data/` directory (conversations, keys, artifacts, timeline)

## Build

```bash
cmake -S Desktop -B Desktop/build
cmake --build Desktop/build -j
./Desktop/build/OmniaDesktop
```

Requires Qt 6 (Core, Gui, Widgets, Network, Concurrent, WebEngineWidgets, PdfWidgets, Svg).

Optional environment:

- `DATA_DIR` — override data directory (default: repo `data/` when run from repo, else `./data`)
- `SANDBOX_EVENTS_PORT` — agent event receiver port (default 8790)
- `CHROMIUM_DAEMON_URL` — Chromium daemon (default `http://127.0.0.1:18787`)
