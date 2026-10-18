"use client";

import * as React from "react";
import { cn } from "@/components/ui";
import { BRAND_ICONS, type BrandIconKey, type BrandIconDef } from "@/components/brand/icons.generated";

export type { BrandIconKey };

/** Very dark brand colors (Vercel, Wikipedia, Markdown…) vanish on the dark theme, so those follow the text color. */
function isNearBlack(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 40;
}

/**
 * The real logo of a provider, model family, search engine, connector or tool, drawn inline as SVG so it scales
 * crisply and single-color marks can follow the theme. Unknown keys render nothing; pass `fallback` for those.
 */
export function BrandIcon({
  name,
  size = 16,
  className,
  monochrome,
  fallback = null,
  title,
}: {
  name: BrandIconKey | string | null | undefined;
  size?: number;
  className?: string;
  /** Force currentColor for every mark (e.g. inside a colored button). */
  monochrome?: boolean;
  fallback?: React.ReactNode;
  title?: string;
}) {
  const def = name ? (BRAND_ICONS as Record<string, BrandIconDef>)[name] : undefined;
  if (!def) return <>{fallback}</>;
  const fill = monochrome || def.mono ? (def.color && !monochrome && !isNearBlack(def.color) ? def.color : "currentColor") : undefined;
  return (
    <svg
      viewBox={def.viewBox}
      width={size}
      height={size}
      role="img"
      aria-label={title ?? def.title}
      className={cn("shrink-0", className)}
      style={fill ? { fill } : undefined}
      fillRule="evenodd"
      dangerouslySetInnerHTML={{ __html: `<title>${title ?? def.title}</title>${def.svg}` }}
    />
  );
}

/**
 * A logo seated in a small rounded tile — the Supabase integrations look. The tile stays neutral so every
 * brand color reads on both themes.
 */
export function BrandTile({
  name,
  size = 28,
  className,
  fallback,
  glow,
}: {
  name: BrandIconKey | string | null | undefined;
  size?: number;
  className?: string;
  fallback?: React.ReactNode;
  glow?: boolean;
}) {
  const has = !!name && name in BRAND_ICONS;
  return (
    <span
      className={cn(
        "brand-tile relative inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-bg-surface-200 text-fg",
        glow && "brand-tile-glow",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {has ? <BrandIcon name={name} size={Math.round(size * 0.58)} /> : fallback}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Resolvers: map app identifiers to a logo key.

const PROVIDER_KEYS: Record<string, BrandIconKey> = {
  anthropic: "claude",
  openai: "openai",
  google: "gemini",
  ollama: "ollama",
  lmstudio: "lmstudio",
  opencode: "opencode",
};

/** Hints matched against a custom provider's id, name or base URL. Order matters: specific before generic. */
const HOST_HINTS: [RegExp, BrandIconKey][] = [
  [/openrouter/i, "openrouter"],
  [/groq/i, "groq"],
  [/deepseek/i, "deepseek"],
  [/together/i, "together"],
  [/fireworks/i, "fireworks"],
  [/mistral/i, "mistral"],
  [/x\.ai|xai|grok/i, "xai"],
  [/perplexity|pplx/i, "perplexity"],
  [/moonshot|kimi/i, "kimi"],
  [/dashscope|qwen|alibaba/i, "qwen"],
  [/bigmodel|zhipu|glm/i, "zhipu"],
  [/z\.ai/i, "zai"],
  [/minimax/i, "minimax"],
  [/huggingface|hf\.co/i, "huggingface"],
  [/nvidia|nim/i, "nvidia"],
  [/cohere/i, "cohere"],
  [/azure/i, "azure"],
  [/bedrock/i, "bedrock"],
  [/amazonaws|aws/i, "aws"],
  [/vertex/i, "vertexai"],
  [/anthropic|claude/i, "claude"],
  [/openai/i, "openai"],
  [/gemini|googleapis|generativelanguage/i, "gemini"],
  [/ollama/i, "ollama"],
  [/lmstudio|lm-studio/i, "lmstudio"],
  [/opencode/i, "opencode"],
];

export function providerIconKey(provider: string | undefined, hint?: string): BrandIconKey | undefined {
  if (!provider) return undefined;
  if (PROVIDER_KEYS[provider]) return PROVIDER_KEYS[provider];
  const hay = `${provider} ${hint ?? ""}`;
  return HOST_HINTS.find(([re]) => re.test(hay))?.[1];
}

const MODEL_HINTS: [RegExp, BrandIconKey][] = [
  [/claude|opus|sonnet|haiku/i, "claude"],
  [/gemini|gemma/i, "gemini"],
  [/gpt|^o\d|openai|chatgpt/i, "openai"],
  [/deepseek/i, "deepseek"],
  [/qwen|qwq/i, "qwen"],
  [/llama|meta/i, "meta"],
  [/mistral|mixtral|codestral|devstral|magistral/i, "mistral"],
  [/kimi|moonshot/i, "kimi"],
  [/glm|zhipu/i, "zhipu"],
  [/grok/i, "grok"],
  [/minimax|abab/i, "minimax"],
  [/command|cohere/i, "cohere"],
  [/nemotron|nvidia/i, "nvidia"],
  [/phi-/i, "microsoft"],
  [/sonar/i, "perplexity"],
];

/** Logo of the lab behind a model id, falling back to its provider's logo. */
export function modelIconKey(modelId: string | undefined, provider?: string): BrandIconKey | undefined {
  const hit = modelId ? MODEL_HINTS.find(([re]) => re.test(modelId))?.[1] : undefined;
  return hit ?? providerIconKey(provider);
}

const SEARCH_KEYS: Record<string, BrandIconKey> = {
  tavily: "tavily",
  brave: "brave",
  serper: "google",
  searxng: "searxng",
  duckduckgo: "duckduckgo",
  bing: "bing",
  exa: "exa",
  jina: "jina",
  firecrawl: "firecrawl",
};

export function searchIconKey(kind: string | undefined): BrandIconKey | undefined {
  return kind ? SEARCH_KEYS[kind] : undefined;
}

const CONNECTOR_HINTS: [RegExp, BrandIconKey][] = [
  [/github/i, "github"],
  [/gitlab/i, "gitlab"],
  [/notion/i, "notion"],
  [/figma/i, "figma"],
  [/linear/i, "linear"],
  [/jira|atlassian/i, "jira"],
  [/supabase/i, "supabase"],
  [/postgres|pg\b/i, "postgresql"],
  [/redis/i, "redis"],
  [/neo4j/i, "neo4j"],
  [/drive/i, "googledrive"],
  [/gmail|mail/i, "gmail"],
  [/sheets/i, "googlesheets"],
  [/docs\.google|gdocs/i, "googledocs"],
  [/discord/i, "discord"],
  [/vercel/i, "vercel"],
  [/cloudflare/i, "cloudflare"],
  [/docker/i, "docker"],
  [/puppeteer/i, "puppeteer"],
  [/chrome|browser|playwright/i, "chrome"],
  [/youtube/i, "youtube"],
  [/reddit/i, "reddit"],
  [/wikipedia/i, "wikipedia"],
  [/brave/i, "brave"],
  [/tavily/i, "tavily"],
  [/exa\b/i, "exa"],
  [/firecrawl/i, "firecrawl"],
  [/huggingface/i, "huggingface"],
  [/npm/i, "npm"],
];

/** Logo for an MCP server from its name, URL or command; generic MCP mark otherwise. */
export function connectorIconKey(...hints: (string | undefined)[]): BrandIconKey {
  const hay = hints.filter(Boolean).join(" ");
  return CONNECTOR_HINTS.find(([re]) => re.test(hay))?.[1] ?? "mcp";
}

/** Logo for a source URL's site when we have its real mark (Wikipedia, GitHub, arXiv…). */
export function siteIconKey(hostname: string | undefined): BrandIconKey | undefined {
  if (!hostname) return undefined;
  const h = hostname.replace(/^www\./, "");
  const map: [RegExp, BrandIconKey][] = [
    [/wikipedia\.org$/, "wikipedia"],
    [/github\.com$/, "github"],
    [/gitlab\.com$/, "gitlab"],
    [/arxiv\.org$/, "arxiv"],
    [/youtube\.com$|youtu\.be$/, "youtube"],
    [/stackoverflow\.com$/, "stackoverflow"],
    [/reddit\.com$/, "reddit"],
    [/npmjs\.com$/, "npm"],
    [/huggingface\.co$/, "huggingface"],
    [/notion\.(so|site)$/, "notion"],
    [/vercel\.(com|app)$/, "vercel"],
    [/supabase\.(com|co)$/, "supabase"],
  ];
  return map.find(([re]) => re.test(h))?.[1];
}

/** Language/runtime logos for code blocks and files. */
export function languageIconKey(langOrName: string | undefined): BrandIconKey | undefined {
  const t = String(langOrName ?? "").toLowerCase();
  if (/(^|\.)(py|python)$/.test(t)) return "python";
  if (/(^|\.)(ts|tsx|typescript)$/.test(t)) return "typescript";
  if (/(^|\.)(js|jsx|mjs|cjs|javascript)$/.test(t)) return "javascript";
  if (/(^|\.)(html?|xml)$/.test(t)) return "html";
  if (/(^|\.)(md|mdx|markdown)$/.test(t)) return "markdown";
  if (/(^|\.)(sh|bash|zsh|shell|console)$/.test(t)) return "bash";
  if (/(^|\.)(rs|rust)$/.test(t)) return "rust";
  if (/(^|\.)(go|golang)$/.test(t)) return "go";
  if (/(^|\.)(sql|psql|postgres)$/.test(t)) return "postgresql";
  if (/(^|\.)(cypher)$/.test(t)) return "neo4j";
  if (/dockerfile/.test(t)) return "docker";
  return undefined;
}

/**
 * A website's real icon: our inline brand mark when we have one, else the site's favicon (the same favicon
 * service the search results already use), else a globe.
 */
export function SiteFavicon({ hostname, size = 14, className }: { hostname: string | undefined; size?: number; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  const key = siteIconKey(hostname);
  if (key) return <BrandIcon name={key} size={size} className={className} />;
  if (!hostname || failed) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={cn("shrink-0 text-fg-muted", className)} aria-hidden>
        <circle cx="12" cy="12" r="9.5" />
        <path d="M2.5 12h19M12 2.5c2.6 2.8 3.9 6 3.9 9.5s-1.3 6.7-3.9 9.5c-2.6-2.8-3.9-6-3.9-9.5S9.4 5.3 12 2.5z" />
      </svg>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-[3px]", className)}
      onError={() => setFailed(true)}
    />
  );
}
