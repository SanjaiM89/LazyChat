import { tool } from "ai";
import { z } from "zod";

import { chromiumExtract, chromiumObserve, chromiumTabs } from "@/lib/chromium";

/**
 * The browser tools.
 *
 * The act primitives (navigate, click, type, read, screenshot) live in the
 * browser family already. These three add what was missing: seeing what a
 * page offers, pulling values out of it, and working with more than one tab.
 */
export function buildBrowserTools() {
  return {
    browser_observe: tool({
      description:
        "Look at what the current page offers: every link, button, field and other interactive element, " +
        "with its label and a selector you can pass to computer_click. Use it before clicking around, so " +
        "you act on the right element instead of guessing at coordinates.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const result = await chromiumObserve();
          return {
            url: result.url,
            title: result.title,
            count: result.elements.length,
            elements: result.elements.slice(0, 80),
          };
        } catch (e) {
          return { error: (e as Error).message || "The page could not be observed." };
        }
      },
    }),

    browser_extract: tool({
      description:
        "Pull named values out of the current page. Give each field a CSS selector (or a name to look " +
        "for in the page text) and the values come back. Use it to read a table, a price, a title — anything " +
        "you would otherwise copy by hand.",
      inputSchema: z.object({
        fields: z
          .record(z.string(), z.string())
          .describe("Field name to selector, e.g. { price: '.price', title: 'h1' }"),
      }),
      execute: async ({ fields }) => {
        try {
          const result = await chromiumExtract(fields);
          return {
            url: result.url,
            title: result.title,
            values: result.values,
            missing: Object.entries(result.values)
              .filter(([, value]) => value === null || value === "")
              .map(([name]) => name),
          };
        } catch (e) {
          return { error: (e as Error).message || "The page could not be read." };
        }
      },
    }),

    browser_tabs: tool({
      description:
        "List the open tabs, open a new one, or close one. The agent works in the tab it opened; the others " +
        "stay where they were.",
      inputSchema: z.object({
        action: z
          .enum(["list", "open", "close"])
          .optional()
          .describe("What to do (default list)"),
        url: z.string().optional().describe("The page to open, for action 'open'"),
        index: z.number().int().min(0).optional().describe("The tab to close, for action 'close'"),
      }),
      execute: async ({ action, url, index }) => {
        try {
          const result = await chromiumTabs(action, { url, index });
          return {
            url: result.url,
            title: result.title,
            count: result.tabs?.length ?? 0,
            tabs: result.tabs ?? [],
          };
        } catch (e) {
          return { error: (e as Error).message || "The tabs could not be reached." };
        }
      },
    }),
  };
}
