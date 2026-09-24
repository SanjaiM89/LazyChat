import "server-only";

import { readJSON, writeJSON } from "@/lib/store";
import { createSandbox, listSandboxes, sandboxExec } from "@/lib/sandbox";


const DAEMON_URL = process.env.CHROMIUM_DAEMON_URL || "http://127.0.0.1:18787";
const SESSION_FILE = "chromium-session.json";
const TIMELINE_FILE = "chromium-timeline.json";
const MAX_STEPS = 80;

export type ChromiumActor = "model" | "user";
export type ChromiumControl = "model" | "user";

export interface ChromiumStep {
  i: number;
  t: number;
  actor: ChromiumActor;
  action: string;
  detail: string;
  url?: string;
  title?: string;
  shot?: string;
}

interface TimelineDoc {
  control: ChromiumControl;
  controlAt: number;
  steps: ChromiumStep[];
}

async function readTimeline(): Promise<TimelineDoc> {
  const doc = await readJSON<TimelineDoc>(TIMELINE_FILE, {
    control: "model",
    controlAt: 0,
    steps: [],
  });
  if (!doc || typeof doc !== "object" || !Array.isArray((doc as any).steps)) {
    return { control: "model", controlAt: 0, steps: [] };
  }
  return {
    control: (doc as any).control === "user" ? "user" : "model",
    controlAt: (doc as any).controlAt || 0,
    steps: (doc as any).steps,
  };
}

async function writeTimeline(doc: TimelineDoc): Promise<void> {
  await writeJSON(TIMELINE_FILE, doc);
}

export async function getControl(): Promise<ChromiumControl> {
  return (await readTimeline()).control;
}

export async function takeControl(actor: ChromiumControl): Promise<TimelineDoc> {
  const doc = await readTimeline();
  doc.control = actor;
  doc.controlAt = Date.now();
  await writeTimeline(doc);
  return doc;
}

export async function listSteps(): Promise<ChromiumStep[]> {
  return (await readTimeline()).steps;
}

export async function recordStep(input: {
  actor: ChromiumActor;
  action: string;
  detail: string;
  url?: string;
  title?: string;
  shot?: string;
}): Promise<ChromiumStep> {
  const doc = await readTimeline();
  const step: ChromiumStep = {
    i: (doc.steps.length ? doc.steps[doc.steps.length - 1].i : 0) + 1,
    t: Date.now(),
    actor: input.actor,
    action: input.action,
    detail: input.detail.slice(0, 500),
    url: input.url,
    title: input.title,
    shot: input.shot,
  };
  doc.steps.push(step);
  while (doc.steps.length > MAX_STEPS) doc.steps.shift();
  await writeTimeline(doc);
  return step;
}

export async function clearTimeline(): Promise<void> {
  const doc = await readTimeline();
  await writeTimeline({ control: doc.control, controlAt: doc.controlAt, steps: [] });
}


async function daemon(path: string, init?: RequestInit, timeoutMs = 60_000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DAEMON_URL}${path}`, { ...init, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.error || `daemon ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function daemonReady(): Promise<boolean> {
  try {
    await daemon("/state", undefined, 5000);
    return true;
  } catch {
    return false;
  }
}

async function findSessionContainer(): Promise<string | null> {
  try {
    const saved = await readJSON<{ sandboxId?: string }>(SESSION_FILE, {});
    if (saved?.sandboxId) {
      const all = await listSandboxes().catch(() => []);
      if (Array.isArray(all) && all.some((s: any) => s.id === saved.sandboxId)) {
        return saved.sandboxId;
      }
    }
  } catch {
  }
  return null;
}

export async function ensureChromium(): Promise<{ sandboxId: string; fresh: boolean }> {
  if (await daemonReady()) {
    const existing = await findSessionContainer();
    return { sandboxId: existing || "attached", fresh: false };
  }
  let sandboxId: string | null = await findSessionContainer();
  if (!sandboxId) {
    const created = await createSandbox({ label: "Chromium" });
    sandboxId = String(created.id);
    await writeJSON(SESSION_FILE, { sandboxId });
  }
  const target: string = sandboxId;
  await sandboxExec(
    target,
    "pkill -f browser-daemon.mjs 2>/dev/null; nohup node /app/browser-daemon.mjs > /tmp/browser-daemon.log 2>&1 & sleep 1; echo started",
    { timeout: 30_000 },
  ).catch((e) => {
    throw new Error(`Chromium container not reachable: ${e.message}`);
  });
  const deadline = Date.now() + 45_000;
  for (;;) {
    if (await daemonReady()) return { sandboxId: target, fresh: true };
    if (Date.now() > deadline) {
      throw new Error("Chromium daemon did not start (rebuild the image: npm run sandbox:build).");
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}


export interface ChromiumResult {
  url: string;
  title: string;
  text?: string;
  image?: string;
}

async function act(
  actor: ChromiumActor,
  action: string,
  detail: string,
  path: string,
  init?: RequestInit,
): Promise<ChromiumResult> {
  const data = await daemon(path, init);
  const result: ChromiumResult = {
    url: data.url || "",
    title: data.title || "",
    text: typeof data.text === "string" ? data.text : undefined,
    image: typeof data.image === "string" ? data.image : undefined,
  };
  await recordStep({ actor, action, detail, url: result.url, title: result.title, shot: result.image });
  return result;
}

export async function chromiumNavigate(actor: ChromiumActor, url: string) {
  return act(actor, "navigate", url, "/navigate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export async function chromiumClick(actor: ChromiumActor, x: number, y: number, label?: string) {
  return act(actor, "click", label || `click (${Math.round(x)}, ${Math.round(y)})`, "/click", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x, y }),
  });
}

export async function chromiumClickSelector(actor: ChromiumActor, selector: string) {
  return act(actor, "click", `click (${selector})`, "/click", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selector }),
  });
}

export async function chromiumType(actor: ChromiumActor, text: string, enter?: boolean) {
  return act(
    actor,
    "type",
    `type "${text.slice(0, 80)}"${enter ? " + Enter" : ""}`,
    "/type",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, enter: !!enter }),
    },
  );
}

export async function chromiumPress(actor: ChromiumActor, key: string) {
  return act(actor, "press", `press ${key}`, "/press", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });
}

export async function chromiumScroll(actor: ChromiumActor, direction: "up" | "down", px?: number) {
  return act(actor, "scroll", `scroll ${direction}`, "/scroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ direction, px: px ?? 500 }),
  });
}

export async function chromiumNav(actor: ChromiumActor, op: "back" | "forward" | "reload") {
  return act(actor, op, op, `/${op}`, { method: "POST" });
}

export interface ChromiumSearchResult extends ChromiumResult {
  engine: string;
  query: string;
  results: { title: string; url: string; hostname: string; position: number }[];
}

export async function chromiumSearch(
  actor: ChromiumActor,
  query: string,
  max = 8,
): Promise<ChromiumSearchResult> {
  const data = await daemon("/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, max }),
  }, 90_000);
  const result: ChromiumSearchResult = {
    url: data.url || "",
    title: data.title || "",
    image: typeof data.image === "string" ? data.image : undefined,
    engine: data.engine || "unknown",
    query,
    results: Array.isArray(data.results) ? data.results : [],
  };
  await recordStep({
    actor,
    action: "search",
    detail: `${result.engine}: "${query}" → ${result.results.length} results`,
    url: result.url,
    title: result.title,
    shot: result.image,
  });
  return result;
}

export async function chromiumRead(): Promise<ChromiumResult> {
  const data = await daemon(`/text?max=12000`);
  return { url: data.url || "", title: data.title || "", text: data.text || "" };
}

export async function chromiumShot(): Promise<ChromiumResult> {
  const data = await daemon(`/screenshot`);
  return { url: data.url || "", title: data.title || "", image: data.image };
}

export async function chromiumState(): Promise<{ url: string; title: string; control: ChromiumControl; steps: number }> {
  const [state, doc] = await Promise.all([
    daemon("/state", undefined, 8000).catch(() => ({ url: "", title: "" })),
    readTimeline(),
  ]);
  return { url: state.url || "", title: state.title || "", control: doc.control, steps: doc.steps.length };
}
