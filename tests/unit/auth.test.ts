/**
 * Auth: Firebase ID-token verification and the server-side role gates.
 *
 * Run: npx tsx --test tests/unit/auth.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } from "jose";

import { verifyIdToken } from "@/lib/auth/verify";
import { H, isSuperEmail } from "@/lib/auth/shared";
import { HttpError, requireConfigAdmin, requireSuper, requireUser, scopeKey } from "@/lib/auth/server";
import { authed, currentUser, scoped } from "@/lib/auth/context";

const PROJECT = "test-project";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string | number } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? `https://securetoken.google.com/${PROJECT}`)
      .setAudience(opts.aud ?? PROJECT)
      .setSubject("uid-1")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "1h")
      .sign(privateKey);
  return { keys, sign };
}

function req(headers: Record<string, string>, method = "GET") {
  return new Request("http://localhost/api/x", { method, headers });
}

describe("verifyIdToken", () => {
  it("accepts a valid token and lower-cases the email", async () => {
    const { keys, sign } = await setup();
    const v = await verifyIdToken(await sign({ email: "A@B.com" }), PROJECT, keys);
    assert.deepEqual(v, { uid: "uid-1", email: "a@b.com" });
  });

  it("rejects wrong audience, wrong issuer, expired and garbage tokens", async () => {
    const { keys, sign } = await setup();
    assert.equal(await verifyIdToken(await sign({}, { aud: "other" }), PROJECT, keys), null);
    assert.equal(await verifyIdToken(await sign({}, { iss: "https://evil.example" }), PROJECT, keys), null);
    assert.equal(await verifyIdToken(await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 }), PROJECT, keys), null);
    assert.equal(await verifyIdToken("not.a.jwt", PROJECT, keys), null);
    assert.equal(await verifyIdToken(undefined, PROJECT, keys), null);
  });

  it("rejects a token signed by a different key", async () => {
    const { keys } = await setup();
    const other = await setup();
    assert.equal(await verifyIdToken(await other.sign({ email: "x@y.z" }), PROJECT, keys), null);
  });
});

describe("role gates", () => {
  const member = { [H.uid]: "u1", [H.email]: "m@x.com", [H.org]: "o1", [H.role]: "member" };
  const admin = { ...member, [H.role]: "admin" };

  it("requireUser throws 401 without identity headers", () => {
    assert.throws(() => requireUser(req({})), (e) => e instanceof HttpError && e.status === 401);
  });

  it("requireUser reads the proxy-set headers", () => {
    const u = requireUser(req(member));
    assert.equal(u.uid, "u1");
    assert.equal(u.orgId, "o1");
    assert.equal(u.orgRole, "member");
    assert.equal(u.isSuper, false);
  });

  it("org members cannot change config; admins and org-less users can", () => {
    assert.throws(() => requireConfigAdmin(req(member)), (e) => e instanceof HttpError && e.status === 403);
    assert.equal(requireConfigAdmin(req(admin)).uid, "u1");
    assert.equal(requireConfigAdmin(req({ [H.uid]: "solo" })).orgId, null);
  });

  it("requireSuper only admits the super flag", () => {
    assert.throws(() => requireSuper(req(admin)), (e) => e instanceof HttpError && e.status === 403);
    assert.equal(requireSuper(req({ ...admin, [H.super]: "1" })).isSuper, true);
  });

  it("scopeKey separates orgs from org-less users", () => {
    assert.equal(scopeKey(requireUser(req(member))), "org-o1");
    assert.equal(scopeKey(requireUser(req({ [H.uid]: "solo" }))), "user-solo");
  });
});

describe("route wrappers", () => {
  it("authed returns 401 JSON and exposes currentUser()", async () => {
    const h = authed(async (_r, user) => Response.json({ seen: currentUser()?.uid, user: user.uid }));
    const denied = await h(req({}), { params: Promise.resolve({}) });
    assert.equal(denied.status, 401);
    const ok = await h(req({ [H.uid]: "u9" }), { params: Promise.resolve({}) });
    assert.deepEqual(await ok.json(), { seen: "u9", user: "u9" });
  });

  it("scoped(adminWrites) blocks org members from POST but not GET", async () => {
    const h = scoped(async (_r: Request, _c: unknown) => Response.json({ ok: true }), { adminWrites: true });
    const member = { [H.uid]: "u1", [H.org]: "o1", [H.role]: "member" };
    assert.equal((await h(req(member, "GET"), {})).status, 200);
    assert.equal((await h(req(member, "POST"), {})).status, 403);
    assert.equal((await h(req({ ...member, [H.role]: "owner" }, "POST"), {})).status, 200);
  });
});

describe("isSuperEmail", () => {
  it("matches the configured address case-insensitively", () => {
    process.env.SUPER_ADMIN_EMAIL = "Super@Admin.com";
    assert.equal(isSuperEmail("super@admin.com"), true);
    assert.equal(isSuperEmail("other@admin.com"), false);
    assert.equal(isSuperEmail(undefined), false);
  });
});
