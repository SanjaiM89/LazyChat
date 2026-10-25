// Thin client for the Python agentic backend (FastAPI).
// The Next.js UI should prefer this over the legacy in-process /api/* routes.

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export async function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${BASE.replace(/\/$/, "")}/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
}

export const backend = {
  health: () => backendFetch("/../healthz").catch(() => fetch(`${BASE}/healthz`)),
  runChat: (body: unknown) => backendFetch("/chat/run", { method: "POST", body: JSON.stringify(body) }),
  streamChat: (body: unknown) => backendFetch("/chat/stream", { method: "POST", body: JSON.stringify(body) }),
  listTools: () => backendFetch("/tools/"),
  runTool: (name: string, body: unknown) => backendFetch(`/tools/${name}/run`, { method: "POST", body: JSON.stringify(body) }),
  listSkills: () => backendFetch("/skills/"),
  listWorkspaces: () => backendFetch("/workspaces/"),
  getGoal: (convId: string) => backendFetch(`/goals/${convId}`),
};