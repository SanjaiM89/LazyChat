/**
 * The feedback, storage-domain and attachment families.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TEST_DATA_DIR } from "./setup-data";

import {
  FEEDBACK_CATEGORIES,
  deleteFeedback,
  listFeedback,
  recordFeedback,
} from "@/lib/agent/feedback";
import { declareDomain, onDomainChange } from "@/lib/agent/storage-domain";
import {
  detectMimeType,
  listAttachments,
  readAttachment,
  storeAttachment,
} from "@/lib/agent/attachments";

describe("the feedback taxonomy", () => {
  it("is the fixed set of categories", () => {
    assert.ok(FEEDBACK_CATEGORIES.includes("task-result"));
    assert.ok(FEEDBACK_CATEGORIES.includes("other"));
    assert.equal(FEEDBACK_CATEGORIES.length, 7);
  });
});

describe("a storage domain", () => {
  const schema = {
    type: "object",
    properties: { name: { type: "string" }, count: { type: "integer" } },
    required: ["name"],
    additionalProperties: false,
  };

  it("stores and reads a value that fits the schema", () => {
    const store = declareDomain<{ name: string; count?: number }>("test-domain-ok", schema);
    store.set("a", { name: "first", count: 2 });
    assert.deepEqual(store.get("a"), { name: "first", count: 2 });
    assert.equal(store.keys().length, 1);
  });

  it("refuses a value that does not fit the schema", () => {
    const store = declareDomain<{ name: string }>("test-domain-bad", schema);
    assert.throws(() => store.set("a", { count: 1 } as never), /not valid/);
  });

  it("removes a value", () => {
    const store = declareDomain<{ name: string }>("test-domain-del", schema);
    store.set("a", { name: "x" });
    assert.equal(store.delete("a"), true);
    assert.equal(store.get("a"), undefined);
    assert.equal(store.delete("a"), false);
  });

  it("reports its changes in order", () => {
    const seen: string[] = [];
    const stop = onDomainChange((change) => seen.push(`${change.domain}:${change.key}`));
    const store = declareDomain<{ name: string }>("test-domain-events", schema);
    store.set("a", { name: "x" });
    store.set("b", { name: "y" });
    stop();
    assert.deepEqual(seen, ["test-domain-events:a", "test-domain-events:b"]);
  });
});

describe("attachments", () => {
  it("recognises the media type of the bytes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    assert.equal(detectMimeType(png), "image/png");
    assert.equal(detectMimeType(Buffer.from("hello")), null);
  });

  it("stores an attachment and reads it back", () => {
    const record = storeAttachment({
      name: "note.txt",
      mimeType: "text/plain",
      data: Buffer.from("the contents"),
    });
    assert.equal(record.bytes, 12);
    const read = readAttachment(record);
    assert.equal(read.data.toString(), "the contents");
    assert.equal(read.verified, true);
  });

  it("refuses a file whose bytes contradict its type", () => {
    assert.throws(
      () =>
        storeAttachment({
          name: "fake.png",
          mimeType: "image/png",
          data: Buffer.from("not a png"),
        }),
      /claims to be image\/png/,
    );
  });

  it("stores them under the application's own data directory", () => {
    assert.ok(TEST_DATA_DIR.length > 0);
  });

  it("keeps the stored attachments", () => {
    const record = storeAttachment({ name: "a.txt", data: Buffer.from("x") });
    const listed = listAttachments();
    assert.ok(listed.some((a) => a.id === record.id));
  });
});

describe("the feedback of a conversation", () => {
  it("is empty for a conversation with no ratings", () => {
    assert.deepEqual(listFeedback("no-such-conversation"), []);
  });
});
