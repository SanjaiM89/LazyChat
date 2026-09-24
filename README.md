# LazyChat (Omnia)

LazyChat is a self-hosted, multi-provider AI workspace. It looks and feels like a
modern AI chat app, but every part of it runs on your own machine: chat with
Claude, GPT, Gemini and local models, search the web with citations, create
viewable artifacts, open side subchats, run autonomous agents inside Docker
sandboxes, and drive a shared Chromium computer that both you and the model can
control.

The in-app brand is **Omnia**. The repository is **LazyChat**.

## Open source

This project is open source under the MIT License (see `LICENSE`). You are free
to use it for personal use, modify it, and share your modifications. If you
build something useful on top of it, contributions back are welcome.

## Features

### Multi-provider chat

- Chat with Anthropic Claude, OpenAI GPT, Google Gemini, OpenCode Zen, Ollama
  and LM Studio local models, plus any OpenAI-, Anthropic- or Gemini-compatible
  custom endpoint (Groq, OpenRouter, vLLM, Claude Code gateways, and more).
- API keys can be pasted in the UI (stored server-side only) or provided
  through environment variables. Saved keys override env vars, no restart
  needed.
- Extended thinking / reasoning controls per model, temperature, max steps for
  the in-chat agentic loop.
- Background runs: closing the tab never kills a reply. Generation continues
  on the server and you can re-attach from anywhere, even another tab.

### File uploads and PDF reading

- Attach files from the button, by drag and drop onto the composer, or by
  pasting. Uploads keep their original filenames.
- PDFs are parsed server-side and their text is handed to the model, so large
  documents work even with providers that reject raw PDF binaries.
- Text-like files (code, markdown, CSV) are inlined as text; images keep
  vision support.

### Web search with inline citations

- Answers carry clickable `[1]`, `[2]` citation pills that jump to the exact
  numbered search result card they came from (and back).
- Bring your own search backend: Tavily, Brave Search, Serper, or a
  self-hosted SearXNG instance. DuckDuckGo stays as the free built-in fallback.

### Subchat (resizable split screen)

- Select any text in a response, right-click, and open it in a subchat — or hit
  the floating button at the top-right of any chat.
- The subchat docks beside the main chat like a tablet split screen and can be
  resized by dragging the divider (double-click resets). Only one subchat can
  be open at a time, with a close button in its header.
- Context is shared both ways: the subchat sees the whole main conversation,
  and the main chat sees what was discussed in the subchat.

### Display settings

- Header gear button: switch between 14 fonts (including Times New Roman),
  change the reading font size, and stretch the chat width up to 1600px.
- One-click reset back to defaults. Everything is remembered on your device.

### Artifacts, agents and skills

- Rich artifacts (code, markdown, HTML, SVG, tables) render in a side panel
  and stay attached to their conversation.
- Autonomous agents run in isolated Docker sandboxes with a shell, file tools
  and a live browser, producing downloadable PDF / DOCX / XLSX / CSV files.
- Custom skills inject your own instructions; MCP servers plug in external
  tools.

### The computer (shared Chromium)

The sandbox panel hosts a persistent Chromium computer driven with a small set
of mouse-and-keyboard primitives (open page, click, type, hotkeys, scroll),
inspired by the PCLLM approach of letting an LLM operate software directly
instead of through APIs.

- The model can use the computer at any time: whenever it needs to read a
  website, or whenever you ask it to do something in the browser.
- Every model action is screenshotted and recorded to a timeline, so you can
  scrub back and forth through exactly what the model did.
- You can interrupt at any moment: seize control in the Chromium panel and
  drive the page yourself (click directly on the screenshot, type, navigate),
  then hand control back to the model. While you hold control, model tools
  yield automatically.

### Planned computer work

- Email: reading inboxes and drafting / sending replies from the computer.
- Messaging integrations: WhatsApp, Telegram, Slack and Messenger — reading
  threads and sending messages on your behalf.
- Repetitive-task automation: record once, replay on a schedule (form filling,
  report downloads, price checks, status reports).
- Stronger element grounding and step-by-step replanning for unexpected
  popups and layout changes.

## How to run it

### Requirements

- Node.js 22+
- Docker (for sandboxes, agents and the Chromium computer)
- At least one provider API key (or a local model via Ollama / LM Studio)

### Install and start

```bash
npm install
cp .env.example .env.local   # then fill in your keys
npm run sandbox:build        # build the sandbox image (needs Docker)
npm run dev                  # app (http://localhost:3000) + sandbox service
```

`npm run dev` starts both the Next.js app and the sandbox service
(`node sandbox/server.mjs`, port 8787) that provisions the Docker containers.

### Production

```bash
npm run build
npm run start                # serves the app on http://localhost:3000
node sandbox/server.mjs      # still required for sandboxes/agents/Chromium
```

### Configuration

- `.env.local` holds provider keys and base URLs; see `.env.example` for the
  full list (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENCODE_API_KEY`, `OLLAMA_BASE_URL`, …).
- Keys pasted in the UI are stored in `data/provider-keys.json` and take
  priority over env vars.
- All runtime state lives under `data/` (conversations, artifacts, keys,
  timelines). It is git-ignored and stays on your machine.

## Repository automation

`.github/workflows/ci.yml` runs on every push and pull request: install,
typecheck (`tsc --noEmit`) and a full production `next build`.

A note on hosting: this app needs a Node.js server plus Docker, so it cannot
run on GitHub Pages (static hosting only). Run it on your own machine, a VPS,
or any host that supports Node and Docker. The repository About section links
to this repo until a deployment URL exists.

## Project layout

- `app/` — Next.js routes, including `/api/chat` (background run engine),
  `/api/upload`, `/api/files`, `/api/chromium`, `/api/models` and the sandbox
  proxy.
- `components/` — chat UI, panels, dialogs, viewers and the subchat split.
- `lib/` — run engine, providers, tools (search, artifacts, agents, computer
  use), stores and registries.
- `sandbox/` — Docker sandbox service (`server.mjs`) and the container image
  (agent runner, Chromium browser daemon, file generators).
- `scripts/` — dev helpers that boot the sandbox service.
- `data/` — local runtime state (git-ignored).
