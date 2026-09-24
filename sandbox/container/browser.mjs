/**
 * Live Chromium browser helper for the sandbox agent.
 * Single browser instance shared across tool calls; screenshots are
 * captured as small JPEG data-URLs for streaming to the mini-computer view.
 */
import { chromium } from "playwright";

export async function launchBrowser(report) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    locale: "en-US",
  });
  context.setDefaultTimeout(30_000);
  // a pristine tab so navigation is instant
  await context.newPage();
  report({ type: "log", message: "Chromium browser ready" });
  return browser;
}

/** JPEG data-url of the current page (compressed so it streams fast). */
export async function screenshotDataUrl(page) {
  const buf = await page.screenshot({
    type: "jpeg",
    quality: 45,
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}
