/**
 * Chat storage helpers: message <-> Firestore doc mapping, incremental diffs, value encoding, token picking.
 *
 * Run: npx tsx --test tests/unit/chat-store.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";

import { CHUNK_CHARS, diffMessageDocs, fromMessageDocs, toMessageDocs } from "@/lib/chat-store";
import { decodeFields, fieldsOf } from "@/lib/firestore-rest";
import { latestToken, readCookie, rememberToken } from "@/lib/auth/token";

const msg = (i: number, text = `hello ${i}`) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", parts: [{ type: "text", text }] });
const hashes = (docs: ReturnType<typeof toMessageDocs>) => new Map(docs.map((d) => [d.id, d.data.h]));

describe("message docs", () => {
  it("round-trips messages in order, whatever order the docs come back in", () => {
    const messages = Array.from({ length: 12 }, (_, i) => msg(i));
    const docs = toMessageDocs(messages).reverse();
    assert.deepEqual(fromMessageDocs(docs), messages);
  });

  it("splits oversized messages into chunks and reassembles them", () => {
    const big = msg(0, "x".repeat(CHUNK_CHARS * 2 + 10));
    const docs = toMessageDocs([big, msg(1)]);
    assert.equal(docs.filter((d) => d.data.idx === 0).length, 3);
    assert.ok(docs.every((d) => d.data.json.length <= CHUNK_CHARS));
    assert.deepEqual(fromMessageDocs(docs), [big, msg(1)]);
  });

  it("keeps ids sortable so Firestore returns messages in order", () => {
    const ids = toMessageDocs(Array.from({ length: 120 }, (_, i) => msg(i))).map((d) => d.id);
    assert.deepEqual([...ids].sort(), ids);
  });
});

describe("incremental diff", () => {
  it("writes nothing when nothing changed", () => {
    const docs = toMessageDocs([msg(0), msg(1)]);
    assert.deepEqual(diffMessageDocs(hashes(docs), docs), { upserts: [], deletes: [] });
  });

  it("writes only the appended or edited message", () => {
    const before = toMessageDocs([msg(0), msg(1)]);
    const appended = toMessageDocs([msg(0), msg(1), msg(2)]);
    assert.deepEqual(diffMessageDocs(hashes(before), appended).upserts.map((d) => d.data.idx), [2]);
    const edited = toMessageDocs([msg(0), msg(1, "changed")]);
    assert.deepEqual(diffMessageDocs(hashes(before), edited).upserts.map((d) => d.data.idx), [1]);
  });

  it("deletes docs that disappeared (compaction, shrinking chunk counts)", () => {
    const before = toMessageDocs([msg(0, "y".repeat(CHUNK_CHARS + 5)), msg(1), msg(2)]);
    const after = toMessageDocs([msg(0, "short")]);
    const { deletes } = diffMessageDocs(hashes(before), after);
    assert.deepEqual(deletes.sort(), before.filter((d) => !after.some((a) => a.id === d.id)).map((d) => d.id).sort());
    assert.equal(deletes.length, 3);
  });
});

describe("firestore value encoding", () => {
  it("round-trips strings, numbers, null and nested maps", () => {
    const data = { a: "s", n: 5, f: 1.5, z: null, usage: { inputTokens: 3, outputTokens: 4 } };
    assert.deepEqual(decodeFields(fieldsOf(data)), data);
  });
});

describe("token registry", () => {
  const tok = (exp: number) =>
    new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("u").setExpirationTime(exp).sign(new TextEncoder().encode("k"));

  it("keeps the newest unexpired token and drops expired ones", async () => {
    const now = Math.floor(Date.now() / 1000);
    const old = await tok(now + 600);
    const fresh = await tok(now + 3000);
    rememberToken("u1", fresh);
    rememberToken("u1", old);
    assert.equal(latestToken("u1"), fresh);
    rememberToken("u2", await tok(now - 10));
    assert.equal(latestToken("u2"), undefined);
    assert.equal(latestToken("nobody"), undefined);
  });

  it("parses the auth cookie", () => {
    assert.equal(readCookie("a=1; omnia_token=abc.def; b=2", "omnia_token"), "abc.def");
    assert.equal(readCookie(null, "omnia_token"), undefined);
  });
});
