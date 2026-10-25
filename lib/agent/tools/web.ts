import { tool } from "ai";
import { z } from "zod";

import { fetchForModel } from "@/lib/agent/fetch";

/**
 * The web tool the model can call on its own: read a page.
 *
 * Only public addresses are reachable — the app runs on the user's machine, so
 * a fetch must not become a way to read the inside of their network.
 */
export function buildWebTools() {
  return {
    web_fetch: tool({
      description:
        "Fetch a web page and return its text. Use it to read documentation, an article, or an API response. " +
        "Only public addresses are reachable. HTML is converted to readable text; other content types are returned as-is.",
      inputSchema: z.object({
        url: z.string().describe("The absolute http(s) URL to fetch"),
        max_chars: z
          .number()
          .int()
          .min(500)
          .max(60_000)
          .optional()
          .describe("Max characters of text to return (default 20000)."),
      }),
      execute: async ({ url, max_chars }) => {
        try {
          const result = await fetchForModel(url, max_chars ?? 20_000);
          return {
            url: result.url,
            status: result.status,
            content_type: result.contentType,
            bytes: result.bytes,
            truncated: result.truncated,
            text: result.text,
          };
        } catch (e) {
          return { error: (e as Error).message || "The fetch failed." };
        }
      },
    }),
  };
}
