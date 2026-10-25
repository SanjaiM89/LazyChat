/**
 * The managed shell environment.
 *
 * Every model shell call runs with a freshly collected environment: the
 * built-in facts plus the facts the registered contributors own. A contributor
 * that claims a taken key, returns an undeclared key, or returns a non-string
 * fails loudly instead of quietly overwriting.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  collectShellEnv,
  registerShellEnvContributor,
  shellEnvContributors,
} from "@/lib/agent/shell-env";

describe("the built-in facts", () => {
  it("names the home, the shell, the session and the directory", () => {
    const env = collectShellEnv({ sessionId: "conv-1", cwd: "/tmp/project" });
    assert.equal(env.DSH_SHELL, "1");
    assert.equal(env.DSH_SESSION_ID, "conv-1");
    assert.equal(env.DSH_WORKSPACE, "/tmp/project");
    assert.ok(env.DSH_HOME.length > 0);
    assert.equal(env.DSH_PROFILE, "omnia");
    assert.ok(env.DSH_PROFILE_DIR.length > 0);
  });

  it("omits the session and the directory when there is none", () => {
    const env = collectShellEnv();
    assert.equal("DSH_SESSION_ID" in env, false);
    assert.equal("DSH_WORKSPACE" in env, false);
  });

  it("collects a fresh environment every time", () => {
    const first = collectShellEnv({ sessionId: "a" });
    const second = collectShellEnv({ sessionId: "b" });
    assert.equal(first.DSH_SESSION_ID, "a");
    assert.equal(second.DSH_SESSION_ID, "b");
  });
});

describe("contributors", () => {
  it("contributes its declared facts", () => {
    registerShellEnvContributor({
      name: "test-region",
      variables: { DSH_TEST_REGION: { description: "A region." } },
      resolve: () => ({ DSH_TEST_REGION: "eu-west" }),
    });
    const env = collectShellEnv();
    assert.equal(env.DSH_TEST_REGION, "eu-west");
    assert.ok(shellEnvContributors().some((c) => c.name === "test-region"));
  });

  it("refuses a duplicate contributor name", () => {
    registerShellEnvContributor({
      name: "test-duplicate",
      variables: { DSH_TEST_DUP_A: { description: "A." } },
      resolve: () => ({}),
    });
    assert.throws(
      () =>
        registerShellEnvContributor({
          name: "test-duplicate",
          variables: { DSH_TEST_DUP_B: { description: "B." } },
          resolve: () => ({}),
        }),
      /already registered/,
    );
  });

  it("refuses a key another contributor already owns", () => {
    registerShellEnvContributor({
      name: "test-owner",
      variables: { DSH_TEST_OWNED: { description: "Owned." } },
      resolve: () => ({}),
    });
    assert.throws(
      () =>
        registerShellEnvContributor({
          name: "test-thief",
          variables: { DSH_TEST_OWNED: { description: "Also mine." } },
          resolve: () => ({}),
        }),
      /already owned/,
    );
  });

  it("refuses a key outside the DSH_ namespace", () => {
    assert.throws(
      () =>
        registerShellEnvContributor({
          name: "test-foreign",
          variables: { PATH_LIKE: { description: "Not ours." } },
          resolve: () => ({}),
        }),
      /DSH_ namespace/,
    );
  });

  it("fails the collection when a contributor returns an undeclared key", () => {
    registerShellEnvContributor({
      name: "test-undeclared",
      variables: { DSH_TEST_DECLARED: { description: "Declared." } },
      // The misbehaviour only happens for one execution, so the registry stays
      // usable for everything else.
      resolve: (execution) =>
        execution.sessionId === "trigger"
          ? ({ DSH_TEST_UNDECLARED: "surprise" } as Record<string, string>)
          : {},
    });
    assert.throws(() => collectShellEnv({ sessionId: "trigger" }), /undeclared key/);
  });

  it("fails the collection when a contributor returns a non-string", () => {
    registerShellEnvContributor({
      name: "test-nonstring",
      variables: { DSH_TEST_NUMBER: { description: "Should be a string." } },
      resolve: (execution) =>
        execution.sessionId === "trigger-number" ? ({ DSH_TEST_NUMBER: 42 } as unknown as Record<string, string>) : {},
    });
    assert.throws(() => collectShellEnv({ sessionId: "trigger-number" }), /non-string value/);
  });
});
