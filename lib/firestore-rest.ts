/**
 * Minimal Firestore REST client that acts as the signed-in user (their Firebase ID token),
 * so security rules apply. Only the value types Omnia stores are supported.
 */
import { FIREBASE_PROJECT_ID } from "@/lib/auth/verify";

export class FirestoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
  /** Token expired / rules rejected: worth queueing the write for later. */
  get authRelated() {
    return this.status === 401 || this.status === 403;
  }
}

type Value =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields?: Record<string, Value> } };

export type Plain = string | number | boolean | null | undefined | { [k: string]: Plain };

export function encode(v: Plain): Value {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  const fields: Record<string, Value> = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) fields[k] = encode(x);
  return { mapValue: { fields } };
}

export function fieldsOf(data: { [k: string]: Plain }): Record<string, Value> {
  return (encode(data) as { mapValue: { fields: Record<string, Value> } }).mapValue.fields;
}

export function decode(v: Value | undefined): Plain {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields);
  return null;
}

export function decodeFields(fields: Record<string, Value> | undefined): { [k: string]: Plain } {
  const out: { [k: string]: Plain } = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decode(v);
  return out;
}

const DB = () => `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const BASE = () => `https://firestore.googleapis.com/v1/${DB()}`;

async function call(token: string, url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* keep statusText */
    }
    throw new FirestoreError(res.status, `Firestore ${res.status}: ${msg}`);
  }
  return res.json();
}

type RawDoc = { name: string; fields?: Record<string, Value> };
const idOf = (name: string) => name.slice(name.lastIndexOf("/") + 1);

export interface Doc {
  id: string;
  data: { [k: string]: Plain };
}

export async function getDoc(token: string, path: string): Promise<Doc | null> {
  const d = (await call(token, `${BASE()}/${path}`)) as RawDoc | null;
  return d ? { id: idOf(d.name), data: decodeFields(d.fields) } : null;
}

/** All documents of a collection (follows pagination). Default order is by document id. */
export async function listDocs(token: string, path: string): Promise<Doc[]> {
  const out: Doc[] = [];
  let pageToken = "";
  do {
    const r = (await call(
      token,
      `${BASE()}/${path}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
    )) as { documents?: RawDoc[]; nextPageToken?: string } | null;
    for (const d of r?.documents ?? []) out.push({ id: idOf(d.name), data: decodeFields(d.fields) });
    pageToken = r?.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

/** Documents in top-level collection `collection` where `field == value`. */
export async function queryEquals(token: string, collection: string, field: string, value: string): Promise<Doc[]> {
  const r = (await call(token, `${BASE()}:runQuery`, {
    method: "POST",
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: { stringValue: value } } },
      },
    }),
  })) as Array<{ document?: RawDoc }> | null;
  return (r ?? []).filter((x) => x.document).map((x) => ({ id: idOf(x.document!.name), data: decodeFields(x.document!.fields) }));
}

export type Write = { set: { path: string; data: { [k: string]: Plain } } } | { delete: { path: string } };

/** Apply writes in batches of 400 (Firestore allows 500 per commit). Not atomic across batches. */
export async function commit(token: string, writes: Write[]): Promise<void> {
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writes.slice(i, i + 400).map((w) =>
      "set" in w
        ? { update: { name: `${DB()}/${w.set.path}`, fields: fieldsOf(w.set.data) } }
        : { delete: `${DB()}/${w.delete.path}` },
    );
    await call(token, `${BASE()}:commit`, { method: "POST", body: JSON.stringify({ writes: batch }) });
  }
}
