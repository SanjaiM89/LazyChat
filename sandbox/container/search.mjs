function stripHtml(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

export async function searchWeb(query, maxResults = 8) {
  const url =
    "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query) + "&kl=wt-wt";
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
  const out = [];
  for (let i = 1; i < blocks.length && out.length < maxResults; i++) {
    const b = blocks[i];
    const titleM = b.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const urlM = b.match(/class="result__a"[^>]*href="([^"]+)"/);
    const snipM = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleM && !snipM) continue;
    const title = stripHtml(titleM?.[1] ?? "");
    let link = (urlM?.[1] ?? "").replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "");
    try {
      link = decodeURIComponent(link);
    } catch {
    }
    let hostname = "";
    try {
      hostname = new URL(link).hostname.replace(/^www\./, "");
    } catch {
    }
    out.push({
      title,
      description: stripHtml(snipM?.[1] ?? ""),
      url: link,
      hostname,
      position: out.length + 1,
    });
  }
  return out;
}
