/**
 * The managed shell environment.
 *
 * Every model shell call runs with a freshly collected environment instead of
 * whatever the process happened to inherit: the built-in facts (the app home,
 * the shell marker, the session id) plus the facts the registered
 * contributors own.
 *
 * A contributor declares every key it may return. An undeclared key, a
 * non-string value, or two contributors claiming the same key fails the call
 * loudly rather than silently overwriting.
 */
import path from "node:path";
import os from "node:os";

import { DATA_DIR } from "@/lib/data-dir";

export interface ShellEnvExecution {
  /** The session the shell runs for. */
  sessionId?: string;
  /** The directory the shell starts in. */
  cwd?: string;
}

export interface ShellEnvContributor {
  /** A stable name; two contributors may not share one. */
  name: string;
  /** The complete set of keys this contributor may return. */
  variables: Record<string, { description: string }>;
  /** The values for one execution. Every key must be declared and a string. */
  resolve(execution: ShellEnvExecution): Record<string, string>;
}

const contributors = new Map<string, ShellEnvContributor>();
const keyOwners = new Map<string, string>();

/**
 * Register a contributor.
 *
 * @param contributor - The contributor to register.
 * @throws When the name is taken, or when it claims a key another owns.
 */
export function registerShellEnvContributor(contributor: ShellEnvContributor): void {
  if (contributors.has(contributor.name)) {
    throw new Error(`shell environment contributor '${contributor.name}' is already registered`);
  }
  for (const key of Object.keys(contributor.variables)) {
    if (!key.startsWith("DSH_")) {
      throw new Error(`shell environment key '${key}' is not in the DSH_ namespace`);
    }
    const owner = keyOwners.get(key);
    if (owner) {
      throw new Error(`shell environment key '${key}' is already owned by '${owner}'`);
    }
  }
  for (const [key, meta] of Object.entries(contributor.variables)) {
    keyOwners.set(key, contributor.name);
    void meta;
  }
  contributors.set(contributor.name, contributor);
}

/** The registered contributors, in registration order. */
export function shellEnvContributors(): ShellEnvContributor[] {
  return [...contributors.values()];
}

/** The built-in facts every shell receives. */
function builtins(execution: ShellEnvExecution): Record<string, string> {
  const env: Record<string, string> = {
    DSH_HOME: DATA_DIR,
    DSH_SHELL: "1",
  };
  if (execution.sessionId) env.DSH_SESSION_ID = execution.sessionId;
  if (execution.cwd) env.DSH_WORKSPACE = execution.cwd;
  return env;
}

/**
 * Collect the environment for one shell call.
 *
 * @param execution - The session and directory the shell runs for.
 * @returns The environment variables to hand the shell.
 * @throws When a contributor returns an undeclared key or a non-string value.
 */
export function collectShellEnv(execution: ShellEnvExecution = {}): Record<string, string> {
  const env = builtins(execution);
  for (const contributor of contributors.values()) {
    const values = contributor.resolve(execution) ?? {};
    for (const [key, value] of Object.entries(values)) {
      if (!(key in contributor.variables)) {
        throw new Error(
          `shell environment contributor '${contributor.name}' returned the undeclared key '${key}'`,
        );
      }
      if (typeof value !== "string") {
        throw new Error(
          `shell environment contributor '${contributor.name}' returned a non-string value for '${key}'`,
        );
      }
      env[key] = value;
    }
  }
  return env;
}

/** The app's install root — the directory the runtime lives in. */
export function appRoot(): string {
  return path.resolve(process.cwd());
}

/** The user's home directory, for the facts that need it. */
export function userHome(): string {
  return os.homedir();
}

// The profile facts: which app the shell belongs to, and where it lives.
registerShellEnvContributor({
  name: "omnia-profile",
  variables: {
    DSH_PROFILE: { description: "The profile the shell belongs to." },
    DSH_PROFILE_DIR: { description: "The directory the profile's runtime lives in." },
  },
  resolve: () => ({
    DSH_PROFILE: "omnia",
    DSH_PROFILE_DIR: appRoot(),
  }),
});
