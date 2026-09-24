import "server-only";

import { search as ddgScrapeSearch, SafeSearchType } from "duck-duck-scrape";
import type { SearchResult } from "@/lib/types";
import {
  listEnabledSearchProviders,
  resolveSearchKey,
} from "@/lib/search-providers";


const cache = new Map<string, { at: number; results: SearchResult[] }>();
const CACHE_TTL = 4 * 60 * 1000;

let chain: Promise<unknown> = Promise.resolve();
function rateLimit<T>(fn: () => Promise<T>, gapMs = 1400): Promise<T> {
  const run = chain.then(() => fn());
  chain = run.catch(() => undefined).then(() => sleep(gapMs));
  return run;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalize(raw: any, position: number): SearchResult | null {
  const title = raw.title || raw.heading || "";
  const description = raw.description || raw.snippet || raw.abstract || "";
  const url = raw.url || "";
  if (!title && !description) return null;
  let hostname = "";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
  }
  return { title, description, url, hostname, position };
}

async function scrapeHtml(query: string): Promise<SearchResult[]> {
  const url =
    "https://html.duckduckgo.com/html/?q=" +
    encodeURIComponent(query) +
    "&kl=wt-wt";
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`search endpoint ${res.status}`);
  const html = await res.text();
  const blocks = html.split('<div class="result results_links');
  const out: SearchResult[] = [];
  for (let i = 1; i < blocks.length && out.length < 12; i++) {
    const b = blocks[i];
    const titleM = b.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const urlM = b.match(/class="result__a"[^>]*href="([^"]+)"/);
    const snipM = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleM && !snipM) continue;
    const strip = (s: string) =>
      s
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
    const title = strip(titleM?.[1] ?? "");
    const url = (urlM?.[1] ?? "").replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "");
    if (!title && !snipM) continue;
    out.push({
      title,
      description: strip(snipM?.[1] ?? ""),
      url,
      hostname: safeHostname(url),
      position: out.length + 1,
    });
  }
  return out;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function searchWeb(
  query: string,
  maxResults = 8,
): Promise<SearchResult[]> {
  const key = query.toLowerCase().trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return hit.results.slice(0, maxResults);
  }

  const results = await rateLimit(async () => {
    try {
      const configured = await listEnabledSearchProviders();
      for (const p of configured) {
        if (p.kind === "duckduckgo") continue;
        try {
          const r = await searchViaProvider(p, query, maxResults);
          if (r.length) return r;
        } catch (e) {
          console.error(`[search] ${p.kind} failed:`, (e as any)?.message || e);
        }
      }
    } catch {
    }
    try {
      const r = (await ddgScrapeSearch(query, {
        safeSearch: SafeSearchType.MODERATE,
      })) as any;
      const list = (r.results || []).map(normalize).filter(Boolean) as SearchResult[];
      if (list.length) return list;
      return await scrapeHtml(query);
    } catch {
      return await scrapeHtml(query);
    }
  });

  cache.set(key, { at: Date.now(), results });
  return results.slice(0, maxResults);
}

async function searchViaProvider(
  p: import("@/lib/search-providers").SearchProviderDef,
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const limit = Math.min(p.maxResults || maxResults, 20);
  const key = resolveSearchKey(p);
  switch (p.kind) {
    case "tavily": {
      if (!key) return [];
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          query,
          max_results: limit,
          include_answer: false,
        }),
      });
      if (!res.ok) throw new Error(`tavily ${res.status}`);
      const data = (await res.json()) as any;
      return ((data.results || []) as any[])
        .map((r, i) =>
          normalize(
            { title: r.title, description: r.content || r.snippet, url: r.url },
            i + 1,
          ),
        )
        .filter(Boolean) as SearchResult[];
    }
    case "brave": {
      if (!key) return [];
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
        { headers: { "X-Subscription-Token": key, accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`brave ${res.status}`);
      const data = (await res.json()) as any;
      const list = (data.web?.results || []) as any[];
      return list
        .map((r, i) =>
          normalize({ title: r.title, description: r.description, url: r.url }, i + 1),
        )
        .filter(Boolean) as SearchResult[];
    }
    case "serper": {
      if (!key) return [];
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "content-type": "application/json", "X-API-KEY": key },
        body: JSON.stringify({ q: query, num: limit }),
      });
      if (!res.ok) throw new Error(`serper ${res.status}`);
      const data = (await res.json()) as any;
      return ((data.organic || []) as any[])
        .map((r, i) =>
          normalize({ title: r.title, description: r.snippet, url: r.link }, i + 1),
        )
        .filter(Boolean) as SearchResult[];
    }
    case "searxng": {
      const base = (p.baseUrl || "").replace(/\/+$/, "");
      if (!base) return [];
      const res = await fetch(
        `${base}/search?q=${encodeURIComponent(query)}&format=json&language=en`,
        { headers: { accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`searxng ${res.status}`);
      const data = (await res.json()) as any;
      return ((data.results || []) as any[])
        .slice(0, limit)
        .map((r, i) =>
          normalize({ title: r.title, description: r.content, url: r.url }, i + 1),
        )
        .filter(Boolean) as SearchResult[];
    }
    default:
      return [];
  }
}

export function rankResults(results: SearchResult[], query: string): SearchResult[] {
  const q = query.toLowerCase();
  const scored = results.map((r) => {
    let score = 0;
    const t = (r.title + " " + r.description).toLowerCase();
    const terms = q.split(/\s+/).filter((s) => s.length > 2);
    for (const term of terms) {
      if (t.includes(term)) score += 2;
      if (r.url.toLowerCase().includes(term)) score += 1;
    }
    if (r.description.length > 200) score += 1;
    return { r, score };
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => s.r);
}
