/**
 * Named, schema-validated key-value domains.
 *
 * A domain is host-side state: it holds values that conform to a declared
 * schema, reads them from memory, and makes every write durable before it
 * resolves. It adds no tools, no prompts and no session events, so it stays
 * invisible to the model.
 */
import fs from "node:fs";
import path from "node:path";

import { DATA_DIR } from "@/lib/data-dir";
import { validateSchema } from "@/lib/agent/json-schema";

export interface StorageDomain<T = unknown> {
  /** The domain's name. */
  readonly name: string;
  /** The value stored under a key. */
  get(key: string): T | undefined;
  /** Store a value. The schema is checked first. */
  set(key: string, value: T): void;
  /** Remove a value. */
  delete(key: string): boolean;
  /** Every value in the domain. */
  list(): T[];
  /** Every key in the domain. */
  keys(): string[];
}

type Listener = (change: { domain: string; key: string; value?: unknown; deleted?: boolean }) => void;

const domains = new Map<string, StorageDomain<never>>();
const listeners = new Set<Listener>();
const caches = new Map<string, Map<string, unknown>>();

/** Observe the changes of every domain, in the order they happen. */
export function onDomainChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(change: { domain: string; key: string; value?: unknown; deleted?: boolean }): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch {
      // A listener that fails never breaks a write.
    }
  }
}

function fileFor(name: string): string {
  return path.join(DATA_DIR, "domains", `${name}.json`);
}

function load(name: string): Map<string, unknown> {
  const cached = caches.get(name);
  if (cached) return cached;
  const store = new Map<string, unknown>();
  try {
    const raw = fs.readFileSync(fileFor(name), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) store.set(key, value);
  } catch {
    // A domain that has never been written starts empty.
  }
  caches.set(name, store);
  return store;
}

function persist(name: string, store: Map<string, unknown>): void {
  const file = fileFor(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: Record<string, unknown> = {};
  for (const [key, value] of store) payload[key] = value;
  // The write is durable before it resolves.
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(temp, file);
}

/**
 * Declare a domain.
 *
 * The schema is the subset the application supports: types, required
 * properties, enums, constants, arrays, additional properties and oneOf.
 */
export function declareDomain<T = unknown>(
  name: string,
  schema: Record<string, unknown>,
): StorageDomain<T> {
  const existing = domains.get(name);
  if (existing) return existing as StorageDomain<T>;

  const domain: StorageDomain<T> = {
    name,
    get(key) {
      return load(name).get(key) as T | undefined;
    },
    set(key, value) {
      const error = validateSchema(value, schema);
      if (error) throw new Error(`The value for "${key}" is not valid: ${error}`);
      const store = load(name);
      store.set(key, value);
      persist(name, store);
      emit({ domain: name, key, value });
    },
    delete(key) {
      const store = load(name);
      if (!store.has(key)) return false;
      store.delete(key);
      persist(name, store);
      emit({ domain: name, key, deleted: true });
      return true;
    },
    list() {
      return [...load(name).values()] as T[];
    },
    keys() {
      return [...load(name).keys()];
    },
  };
  domains.set(name, domain as StorageDomain<never>);
  return domain;
}

/** A domain that was already declared. */
export function domain<T = unknown>(name: string): StorageDomain<T> | undefined {
  return domains.get(name) as StorageDomain<T> | undefined;
}
