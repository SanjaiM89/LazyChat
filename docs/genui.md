# Streaming chat, generative UI (Prefab) and documents

## SSE stream (`lib/chat-runs.ts`, `lib/sse.ts`, `lib/resilient-sse.ts`)
- Every chunk frame has `id: N` (chunks consumed so far); reconnect with `?cursor=N` or `Last-Event-ID`.
- Adjacent text/reasoning/tool-input deltas are coalesced on the wire; writes honour backpressure; `data-heartbeat`
  frames prove liveness; every stream ends with `finish`/`error`/`abort` and `[DONE]`.
- The browser wraps the response in `resilientSse`: on a drop or 35 s of silence it reconnects from the last id with
  backoff, so the AI SDK sees one gap-free stream. Evicted runs answer 204 (the saved chat is loaded instead).
- Attaching to a live run replays it from chunk 0 into a fresh assistant message (the partial message in the snapshot
  is dropped client-side to avoid duplicates).

## Generative UI
- The model calls `render_ui({ title, ui })` with a Prefab envelope (protocol 0.3, JSON). `search_ui_components`
  returns exact props from `lib/genui/catalog.json` (generated from the renderer bundle: `npm run genui:catalog`).
- `lib/genui/envelope.ts` validates (unknown components with "did you mean", forbidden actions, size/depth caps) and
  repairs half-streamed input. The tool result tells the model what to fix.
- The official renderer (`@prefecthq/prefab-ui`, copied to `public/prefab` by `scripts/copy-prefab.mjs`) runs in a
  sandboxed iframe (opaque origin). `lib/genui/host.ts` is a minimal MCP-Apps host: it answers `ui/initialize`, delivers
  envelopes as tool results, turns `SendMessage` into a chat message and refuses tool calls.
- Streaming: `useGenuiEnvelope` repairs the growing `tool-input` and updates the iframe at ~8 Hz.

## Documents
`generate_document` builds real .docx (`docx`), .pdf (`pdf-lib`, Latin text) and .xlsx (`xlsx`, live formulas with cached
values) files from a structured spec and shows them as inline cards (open in panel / download).

## Checks
`npm run test:auth` (unit + stream tests), `npm run test:e2e:genui` (real browser: streamed render, state, actions,
sandbox), `node scripts/e2e-genui-app.mjs` against `npm run dev`.
