#!/bin/bash
# End-to-end sandbox agent test (bypasses the Next app, drives the service directly).
set -u
BASE="http://127.0.0.1:8787"

# Build env payload for the container from the ambient Anthropic proxy config.
ENV_JSON=$(node -e '
  const pick = (k) => process.env[k] || undefined;
  const env = {};
  for (const k of ["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_BASE_URL","ANTHROPIC_MODEL","OPENAI_API_KEY","GOOGLE_API_KEY","GEMINI_API_KEY","OLLAMA_BASE_URL","LMSTUDIO_BASE_URL"]) {
    const v = pick(k); if (v) env[k] = v;
  }
  process.stdout.write(JSON.stringify(env));
')

TASK="Write a short markdown file at /workspace/out/greeting.md with a friendly hello message, then write one line to /workspace/out/note.txt. Do NOT use the browser. Keep it minimal."

echo "== creating sandbox with runner =="
CREATE=$(curl -s -X POST "$BASE/containers" -H 'content-type: application/json' -d "{
  \"image\":\"omnia-sandbox:latest\",
  \"label\":\"agent-test\",
  \"env\":$ENV_JSON,
  \"runner\":{
    \"task\": $(node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$TASK"),
    \"provider\":\"anthropic\",
    \"model\":\"deepseek-v4-flash\",
    \"engine\":\"tool-loop\"
  }
}")
echo "$CREATE"
ID=$(echo "$CREATE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).id||"")}catch{}})')
if [ -z "$ID" ]; then echo "NO ID"; exit 1; fi
echo "sandbox id: $ID"
echo "$ID" > /tmp/agent-test-id

echo "== streaming events (max 150s) =="
timeout 150 curl -sN "$BASE/containers/$ID/events" | node -e '
  let s = ""; let count = 0; let t0 = Date.now();
  process.stdin.on("data", (d) => {
    s += d.toString();
    let i;
    while ((i = s.indexOf("\n\n")) >= 0) {
      const block = s.slice(0, i); s = s.slice(i + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const evt = JSON.parse(line.slice(5).trim());
          count++;
          const el = ((Date.now() - t0) / 1000).toFixed(1);
          if (evt.type === "screenshot") {
            console.log(`[${el}s] screenshot ${evt.image.length} chars`);
          } else {
            console.log(`[${el}s] ${evt.type}${evt.value !== undefined ? "=" + evt.value : ""} ${evt.message ? "| " + String(evt.message).slice(0, 140) : ""}`);
          }
          if (evt.type === "close") process.exit(0);
        } catch {}
      }
    }
  });
  process.stdin.on("end", () => { console.log("(stream ended, total events: " + count + ")"); process.exit(0); });
'
echo "== done streaming =="
