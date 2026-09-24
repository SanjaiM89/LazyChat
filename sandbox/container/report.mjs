const HOST = process.env.SANDBOX_HOST || "http://127.0.0.1:8787";
const ID = process.env.SANDBOX_ID || "local";

let queue = [];
let timer = null;
let bootLog = [];

export function reporterBoot(...args) {
  return args;
}

export function report(evt) {
  if (!evt || typeof evt.type !== "string") return;
  if (evt.type === "screenshot") {
    void sendScreenshot(evt.image);
    return;
  }
  queue.push({ ...evt, t: Date.now() });
  if (!timer) timer = setTimeout(flush, 100);
}

export async function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.length) return;
  const batch = queue.splice(0, queue.length);
  try {
    await fetch(`${HOST}/agent-events/${ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
  } catch {
    bootLog = bootLog.concat(batch).slice(-200);
  }
}

let lastShot = 0;
async function sendScreenshot(image) {
  const now = Date.now();
  if (now - lastShot < 400) return;
  lastShot = now;
  try {
    await fetch(`${HOST}/agent-events/${ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [{ type: "screenshot", image }] }),
      keepalive: true,
    });
  } catch {
  }
}

process.on("exit", () => {
  if (queue.length) {
    fetch(`${HOST}/agent-events/${ID}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: queue }),
      keepalive: true,
    }).catch(() => {});
  }
});
