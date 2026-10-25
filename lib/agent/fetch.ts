import dns from "node:dns/promises";
import net from "node:net";

/**
 * Fetch a page for the model.
 *
 * Only public addresses are reachable: the app runs on the user's machine, so
 * a fetch is a way to read the inside of their network unless it is fenced
 * off. Loopback, private and link-local addresses are refused, and the check
 * happens again after every redirect.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

/** Set OMNIA_ALLOW_PRIVATE_FETCH=1 to let the model read local addresses. */
const ALLOW_PRIVATE = process.env.OMNIA_ALLOW_PRIVATE_FETCH === "1";

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map((p) => Number(p));
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80")) return true;
    // IPv4-mapped addresses carry the IPv4 rules.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https URLs can be fetched (got ${url.protocol}).`);
  }
  if (ALLOW_PRIVATE) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`${host} is a private address.`);
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve ${host}.`);
  }
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new Error(`${host} resolves to a private address.`);
    }
  }
}

/** Strip the parts of an HTML page a reader does not want. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface FetchResult {
  url: string;
  status: number;
  contentType: string;
  text: string;
  bytes: number;
  truncated: boolean;
}

/** Fetch a URL and return its readable text. */
export async function fetchForModel(url: string, maxChars = 20_000): Promise<FetchResult> {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "Omnia/1.0 (+agent)",
          accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`${res.status} without a location header.`);
      current = new URL(location, current);
      continue;
    }

    const contentType = res.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await res.arrayBuffer());
    const bytes = buffer.length;
    const truncated = bytes > MAX_BYTES;
    const slice = truncated ? buffer.subarray(0, MAX_BYTES) : buffer;
    const raw = slice.toString("utf8");
    const text = contentType.includes("html") ? htmlToText(raw) : raw;
    return {
      url: current.toString(),
      status: res.status,
      contentType,
      text: text.slice(0, maxChars),
      bytes,
      truncated: truncated || text.length > maxChars,
    };
  }
  throw new Error("Too many redirects.");
}
