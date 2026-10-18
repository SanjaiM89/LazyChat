// Usage: node scripts/gen-brand-icons.mjs <dir with lobe/package and si/package unpacked> components/brand/icons.generated.ts
// (npm pack @lobehub/icons-static-svg simple-icons, then untar into lobe/ and si/).
import fs from "node:fs";
import path from "node:path";
const S = process.argv[2], out = process.argv[3];
const lobe = (f) => path.join(S, "lobe/package/icons", f + ".svg");
const si = (f) => path.join(S, "si/package/icons", f + ".svg");
const siData = JSON.parse(fs.readFileSync(path.join(S, "si/package/data/simple-icons.json"), "utf8"));
const siList = Array.isArray(siData) ? siData : siData.icons;
const slugOf = (t) => t.toLowerCase().replace(/\+/g,"plus").replace(/\./g,"dot").replace(/&/g,"and").replace(/[^a-z0-9]/g,"");
const siHex = (slug) => { const e = siList.find((i) => (i.slug || slugOf(i.title)) === slug); return e ? "#" + e.hex : null; };
// [key, source, file, title]
const L = [
  ["anthropic","lobe","anthropic","Anthropic"],["claude","lobe","claude-color","Claude"],
  ["openai","lobe","openai","OpenAI"],["gemini","lobe","gemini-color","Gemini"],["google","lobe","google-color","Google"],
  ["ollama","lobe","ollama","Ollama"],["lmstudio","lobe","lmstudio","LM Studio"],["opencode","lobe","opencode","OpenCode"],
  ["deepseek","lobe","deepseek-color","DeepSeek"],["qwen","lobe","qwen-color","Qwen"],["meta","lobe","meta-color","Meta"],
  ["mistral","lobe","mistral-color","Mistral"],["kimi","lobe","kimi-color","Kimi"],["moonshot","lobe","moonshot","Moonshot"],
  ["zhipu","lobe","zhipu-color","Zhipu"],["zai","lobe","zai","Z.ai"],["grok","lobe","grok","Grok"],["xai","lobe","xai","xAI"],
  ["groq","lobe","groq","Groq"],["minimax","lobe","minimax-color","MiniMax"],["openrouter","lobe","openrouter","OpenRouter"],
  ["perplexity","lobe","perplexity-color","Perplexity"],["together","lobe","together-color","Together"],
  ["fireworks","lobe","fireworks-color","Fireworks"],["huggingface","lobe","huggingface-color","Hugging Face"],
  ["nvidia","lobe","nvidia-color","NVIDIA"],["cohere","lobe","cohere-color","Cohere"],["microsoft","lobe","microsoft-color","Microsoft"],
  ["azure","lobe","azure-color","Azure"],["aws","lobe","aws-color","AWS"],["bedrock","lobe","bedrock-color","Bedrock"],
  ["vertexai","lobe","vertexai-color","Vertex AI"],["tavily","lobe","tavily-color","Tavily"],["brave","lobe","brave-color","Brave"],
  ["searxng","lobe","searxng-color","SearXNG"],["bing","lobe","bing-color","Bing"],["exa","lobe","exa-color","Exa"],
  ["jina","lobe","jina","Jina"],["firecrawl","lobe","firecrawl-color","Firecrawl"],["github","lobe","github","GitHub"],
  ["notion","lobe","notion","Notion"],["figma","lobe","figma-color","Figma"],["mcp","lobe","mcp","MCP"],
  ["duckduckgo","si","duckduckgo","DuckDuckGo"],["docker","si","docker","Docker"],["chrome","si","googlechrome","Chrome"],
  ["python","si","python","Python"],["postgresql","si","postgresql","PostgreSQL"],["supabase","si","supabase","Supabase"],
  ["linear","si","linear","Linear"],["jira","si","jira","Jira"],["googledrive","si","googledrive","Google Drive"],
  ["gmail","si","gmail","Gmail"],["wikipedia","si","wikipedia","Wikipedia"],["youtube","si","youtube","YouTube"],
  ["stackoverflow","si","stackoverflow","Stack Overflow"],["reddit","si","reddit","Reddit"],["gitlab","si","gitlab","GitLab"],
  ["vercel","si","vercel","Vercel"],["cloudflare","si","cloudflare","Cloudflare"],["javascript","si","javascript","JavaScript"],
  ["typescript","si","typescript","TypeScript"],["html","si","html5","HTML"],["markdown","si","markdown","Markdown"],
  ["arxiv","si","arxiv","arXiv"],["discord","si","discord","Discord"],["npm","si","npm","npm"],["nodejs","si","nodedotjs","Node.js"],
  ["redis","si","redis","Redis"],["neo4j","si","neo4j","Neo4j"],["bash","si","gnubash","Bash"],["linux","si","linux","Linux"],
  ["googlesheets","si","googlesheets","Google Sheets"],["googledocs","si","googledocs","Google Docs"],["rust","si","rust","Rust"],
  ["go","si","go","Go"],["puppeteer","si","puppeteer","Puppeteer"],
];
const entries = [];
for (const [key, src, file, title] of L) {
  const p = src === "lobe" ? lobe(file) : si(file);
  if (!fs.existsSync(p)) { console.warn("missing", p); continue; }
  let svg = fs.readFileSync(p, "utf8");
  const viewBox = (svg.match(/viewBox="([^"]+)"/) || [])[1] || "0 0 24 24";
  let inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>[\s\S]*?<\/title>/, "");
  // namespace gradient/clip ids so several copies on one page stay unique per key
  inner = inner.replace(/id="([^"]+)"/g, (_, id) => `id="bi-${key}-${id}"`).replace(/url\(#([^)]+)\)/g, (_, id) => `url(#bi-${key}-${id})`).replace(/href="#([^"]+)"/g, (_, id) => `href="#bi-${key}-${id}"`);
  let color = null, mono = false;
  if (src === "si") { color = siHex(file); mono = true; }
  else mono = /fill="currentColor"/.test(svg) && !file.endsWith("-color");
  entries.push({ key, title, viewBox, inner: inner.trim(), color, mono });
}
const body = entries.map((e) => `  ${JSON.stringify(e.key)}: { title: ${JSON.stringify(e.title)}, viewBox: ${JSON.stringify(e.viewBox)}, ${e.color ? `color: ${JSON.stringify(e.color)}, ` : ""}mono: ${e.mono}, svg: ${JSON.stringify(e.inner)} },`).join("\n");
fs.writeFileSync(out, `// Generated from @lobehub/icons-static-svg (MIT) and simple-icons (CC0). Brand marks belong to their owners.
// Regenerate with scripts/gen-brand-icons.mjs rather than editing by hand.

export interface BrandIconDef {
  title: string;
  viewBox: string;
  /** Official brand color for single-color marks (simple-icons); multi-color marks carry their own fills. */
  color?: string;
  /** Single-color mark drawn with currentColor. */
  mono: boolean;
  svg: string;
}

export const BRAND_ICONS = {
${body}
} satisfies Record<string, BrandIconDef>;

export type BrandIconKey = keyof typeof BRAND_ICONS;
`);
console.log("wrote", entries.length);
