/**
 * Streaming reasoning visibility. A reasoning model can spend seconds emitting
 * hidden chain-of-thought before the first answer token; the block must show
 * that stream instead of looking frozen. Pure server render, no browser.
 *
 * Run: `npm run test:ui`
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ThinkingBlock } from "../../components/ThinkingBlock";

describe("ThinkingBlock", () => {
  it("shows reasoning text while it is still streaming", () => {
    const html = renderToStaticMarkup(
      createElement(ThinkingBlock, {
        text: "Checking the request…",
        streaming: true,
      }),
    );
    assert.match(html, /Checking the request/);
    assert.match(html, /stream-caret/);
  });

  it("collapses settled reasoning until the user opens it", () => {
    const html = renderToStaticMarkup(
      createElement(ThinkingBlock, {
        text: "Checking the request…",
        streaming: false,
      }),
    );
    assert.doesNotMatch(html, /Checking the request/);
    assert.match(html, /Thought/);
  });
});
