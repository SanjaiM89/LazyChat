import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

/**
 * The browser client talks to the daemon over HTTP; a fake daemon is enough
 * to check what the app does with the answers.
 */
let server: http.Server;
let seen: { method: string; path: string; body: string }[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      seen.push({ method: req.method ?? "", path: req.url ?? "", body });
      const json = (payload: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url === "/observe") {
        return json({
          url: "https://example.test/page",
          title: "Example",
          elements: [
            { role: "button", label: "Buy now", selector: "#buy" },
            { role: "a", label: "Docs", selector: "a[href='/docs']" },
          ],
        });
      }
      if (req.url === "/extract") {
        return json({
          url: "https://example.test/page",
          title: "Example",
          values: { price: "$42", name: null },
        });
      }
      if (req.url === "/tabs") {
        return json({
          url: "https://example.test/page",
          title: "Example",
          tabs: [
            { index: 0, url: "https://example.test/page", title: "Example", active: true },
            { index: 1, url: "https://example.test/other", title: "Other", active: false },
          ],
        });
      }
      json({});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.env.CHROMIUM_DAEMON_URL = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

test("observing the page returns its interactive elements", async () => {
  const { chromiumObserve } = await import("@/lib/chromium");
  const result = await chromiumObserve();
  assert.equal(result.url, "https://example.test/page");
  assert.equal(result.elements.length, 2);
  assert.equal(result.elements[0].selector, "#buy");
  assert.equal(result.elements[1].label, "Docs");
});

test("extracting asks the daemon for the named fields", async () => {
  const { chromiumExtract } = await import("@/lib/chromium");
  const result = await chromiumExtract({ price: ".price", name: ".name" });
  assert.equal(result.values.price, "$42");
  assert.equal(result.values.name, null);
  const call = seen.find((entry) => entry.path === "/extract");
  assert.ok(call);
  assert.deepEqual(JSON.parse(call.body).fields, { price: ".price", name: ".name" });
});

test("the tabs are listed and can be opened", async () => {
  const { chromiumTabs } = await import("@/lib/chromium");
  const listed = await chromiumTabs("list");
  assert.equal(listed.tabs?.length, 2);
  assert.equal(listed.tabs?.[0].active, true);

  await chromiumTabs("open", { url: "https://example.test/new" });
  const opened = seen.find((entry) => entry.method === "POST" && entry.path === "/tabs");
  assert.ok(opened);
  assert.equal(JSON.parse(opened.body).action, "open");
  assert.equal(JSON.parse(opened.body).url, "https://example.test/new");
});
