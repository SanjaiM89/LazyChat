/**
 * FalkorDB connection wrapper + serialisation helpers.
 *
 * This is the one place that talks to the database. Everything above it works
 * in plain objects (`BrainNode` / `BrainEdge` / rows), which keeps the agent
 * tools, memory layer and API routes free of driver details.
 *
 * The Node driver differs from the Python one in two ways that matter here:
 *   - result rows are objects keyed by RETURN alias (not positional lists);
 *   - nodes/edges/paths arrive already parsed into plain objects.
 * Both are handled once, here.
 */
import { FalkorDB } from "falkordblite";
import type { Graph } from "falkordblite";

import { brainConfig } from "./config";
import path from "node:path";
import { DATA_DIR } from "@/lib/data-dir";
import { msFromEnv, withTimeout } from "./timeout";
import type { BrainEdge, BrainNode } from "./types";

export class GraphError extends Error {}

/** A result row, keyed by the RETURN alias. */
export type Row = Record<string, unknown>;

/** Recursive param shape accepted by the driver (mirrors redis QueryParams). */
type QueryParamValue = string | number | boolean | null | QueryParamValue[] | { [key: string]: QueryParamValue };
type QueryParams = { [key: string]: QueryParamValue };

export type RawNode = { id: number; labels: string[]; properties: Record<string, unknown> };
export type RawEdge = {  id: number;
  sourceId: number;
  destinationId: number;
  properties: Record<string, unknown>;
  relationshipType: string;
};
export type RawPath = { nodes: RawNode[]; edges: RawEdge[] };
function isRawNode(value: unknown): value is RawNode {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "number" && Array.isArray(v.labels) && !!v.properties;
}

function isRawEdge(value: unknown): value is RawEdge {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sourceId === "number" &&
    typeof v.destinationId === "number" &&
    typeof v.relationshipType === "string"
  );
}

function isRawPath(value: unknown): value is RawPath {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.nodes) && Array.isArray(v.edges);
}

/** Coerce a driver value into a serialised node, or null if it is not one. */
export function coerceNode(value: unknown): BrainNode | null {
  return isRawNode(value) ? nodeToDict(value) : null;
}

/** Coerce a driver value into a serialised edge, or null if it is not one. */
export function coerceEdge(value: unknown): BrainEdge | null {
  return isRawEdge(value) ? edgeToDict(value) : null;
}

/** Stable business id: the `id` property, falling back to the element id. */
export function nodeId(node: RawNode): string {
  const props = node.properties ?? {};
  if (props.id !== undefined && props.id !== null) return String(props.id);
  return String(node.id);
}

export function nodeToDict(node: RawNode): BrainNode {
  const props = { ...(node.properties ?? {}) };
  const labels = Array.isArray(node.labels) ? node.labels : [];
  const label = labels[0] ?? "Node";
  return {
    id: nodeId(node),
    labels: [...labels],
    label,
    name:
      (props.name as string) ||
      (props.key as string) ||
      (props.title as string) ||
      nodeId(node),
    properties: props,
    element_id: node.id,
  };
}

export function edgeToDict(edge: RawEdge, elementToBusiness?: Map<number, string>): BrainEdge {
  const map = elementToBusiness ?? new Map<number, string>();
  return {
    id: edge.id,
    source: map.get(edge.sourceId) ?? String(edge.sourceId),
    target: map.get(edge.destinationId) ?? String(edge.destinationId),
    type: edge.relationshipType ?? "",
    properties: { ...(edge.properties ?? {}) },
  };
}

/**
 * Scan query rows for nodes/edges/paths and build a de-duplicated subgraph.
 *
 * Values are walked generically because a row may hold a node, a list of
 * nodes, or a whole path — the tools return all three shapes.
 */
export function collectSubgraph(rows: Row[]): { nodes: BrainNode[]; edges: BrainEdge[] } {
  const nodes = new Map<string, BrainNode>();
  const elementToBusiness = new Map<number, string>();
  const rawEdges: RawEdge[] = [];

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (isRawNode(value)) {
      const d = nodeToDict(value);
      nodes.set(d.id, d);
      elementToBusiness.set(value.id, d.id);
      return;
    }
    if (isRawEdge(value)) {
      rawEdges.push(value);
      return;
    }
    if (isRawPath(value)) {
      for (const n of value.nodes) walk(n);
      for (const e of value.edges) walk(e);
    }
  };

  for (const row of rows) {
    for (const value of Object.values(row)) walk(value);
  }

  const edges: BrainEdge[] = [];
  const seen = new Set<string>();
  for (const raw of rawEdges) {
    const d = edgeToDict(raw, elementToBusiness);
    const key = `${d.source}|${d.target}|${d.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(d);
  }
  return { nodes: [...nodes.values()], edges };
}

/** Marker key for the process-wide connection (survives HMR in dev). */
const CONNECTION_KEY = Symbol.for("lazychat.brain.falkordb");

type CachedConnection = { promise: Promise<FalkorClient>; client?: FalkorClient };

/**
 * Driver knobs the FalkorDB package passes straight through to node-redis but
 * does not declare on its own options type.
 */
type DriverKnobs = {
  /**
   * Bound the retry loop: node-redis otherwise keeps `connect()` pending
   * forever while the endpoint is unreachable, and a pending promise cached
   * process-wide poisons every later awaiter.
   */
  reconnectStrategy?: (retries: number, cause: Error) => false | number;
  /** Fail fast while reconnecting instead of queueing commands indefinitely. */
  disableOfflineQueue?: boolean;
};

/** Deadlines for every round trip — env-overridable so tests can shrink them. */
const connectTimeoutMs = () => msFromEnv("BRAIN_CONNECT_TIMEOUT_MS", 6_000);
const queryTimeoutMs = () => msFromEnv("BRAIN_QUERY_TIMEOUT_MS", 10_000);

/**
 * A driver-level failure (dead socket, closed client, auth) as opposed to a
 * bad Cypher statement — the former must evict the connection, the latter must
 * leave it alone.
 */
function isConnectionFault(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /(closed|closing|reconnect|connection|socket|timed? ?out|timeout|ECONN[A-Z]*|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN|NOAUTH|LOADING)/i.test(
    msg,
  );
}

/**
 * Readable text for a driver error. node-redis reports refused connections as
 * an `AggregateError` whose `.message` is empty — the causes (one per resolved
 * address) live in `.errors`.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const causes = (err as Error & { errors?: Error[] }).errors;
  if (!err.message && Array.isArray(causes) && causes.length) {
    return causes.map((cause) => cause.message).join("; ");
  }
  return err.message;
}

export class FalkorClient {
  readonly graphName: string;
  private readonly db: FalkorDB;
  private readonly graph: Graph;

  private constructor(db: FalkorDB, graphName: string) {
    this.db = db;
    this.graphName = graphName;
    this.graph = db.selectGraph(graphName);
  }

  /**
   * Process-wide singleton.
   *
   * The cached promise is bounded: a connect that never settles would hang
   * every later awaiter (routes and chat runs alike) for the life of the
   * process, so a wedged entry is dropped instead of awaited forever — and if
   * it eventually connects anyway, that orphan socket is closed rather than
   * leaked.
   */
  static async get(): Promise<FalkorClient> {
    const globalStore = globalThis as unknown as Record<symbol, CachedConnection | undefined>;
    let entry = globalStore[CONNECTION_KEY];
    if (!entry) {
      const fresh: CachedConnection = { promise: FalkorClient.create() };
      globalStore[CONNECTION_KEY] = fresh;
      fresh.promise.then(
        (client) => {
          if (globalStore[CONNECTION_KEY] !== fresh) {
            void client.close().catch(() => {});
            return;
          }
          fresh.client = client;
        },
        () => {
          // Rejection is handled by the awaiter below.
        },
      );
      entry = fresh;
    }
    try {
      return await withTimeout(entry.promise, connectTimeoutMs(), "FalkorDB connect");
    } catch (err) {
      // Do not cache a failed connection — the next request should retry.
      if (globalStore[CONNECTION_KEY] === entry) globalStore[CONNECTION_KEY] = undefined;
      throw err instanceof GraphError
        ? err
        : new GraphError(
            `Cannot connect to FalkorDB at ${brainConfig().falkordb.host}:${brainConfig().falkordb.port}: ${describeError(err)}`,
          );
    }
  }

  private static async create(): Promise<FalkorClient> {
    const { falkordb } = brainConfig();
    const dbPath = process.env.FALKORDB_PATH || path.join(DATA_DIR, "falkordb");
    const redisServerPath = process.env.REDIS_SERVER_PATH || path.join(process.cwd(), "bin", "redis-server");
    // Ensure the bundled redis-server can find its shared libraries.
    process.env.LD_LIBRARY_PATH = path.join(process.cwd(), "lib") + (process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : "");
    const modulePath = process.env.FALKORDB_MODULE_PATH || path.join(process.cwd(), "node_modules", "falkordblite", "bin", "linux-x64", "falkordb.so");
    try {
      const db = await withTimeout(
        FalkorDB.open({ path: dbPath, redisServerPath, modulePath }),
        connectTimeoutMs(),
        "FalkorDB connect",
      );
      return new FalkorClient(db, falkordb.graphName);
    } catch (err) {
      throw new GraphError(`Cannot start embedded FalkorDB at ${dbPath}: ${describeError(err)}`);
    }
  }

  /**
   * Forget (and close) this connection so the next `get()` reconnects: a
   * socket that timed out or lost its link must not serve the next request
   * either — that is how a single dead connection used to wedge the process.
   */
  private evict(): void {
    const store = globalThis as unknown as Record<symbol, CachedConnection | undefined>;
    if (store[CONNECTION_KEY]?.client === this) store[CONNECTION_KEY] = undefined;
    void this.close().catch(() => {});
  }

  /** Execute a Cypher query and return its rows. */
  async query<T = Row>(cypher: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const start = Date.now();
    try {
      const reply = await withTimeout(
        this.graph.query(cypher, { params: params as QueryParams }),
        queryTimeoutMs(),
        "Cypher query",
      );
      const rows = (reply.data ?? []) as T[];
      this.log(cypher, params, rows.length, Date.now() - start);
      return rows;
    } catch (err) {
      // A round trip that never returns (half-open socket, reconnect queue) is
      // a dead connection rather than a slow query: surface it to the caller
      // and make the next attempt start from a fresh socket.
      if (isConnectionFault(err)) this.evict();
      throw new GraphError(`Cypher failed: ${(err as Error).message}; query=${JSON.stringify(cypher)}`);
    }
  }

  /** Execute a write query, discarding the result. */
  async write(cypher: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.query(cypher, params);
  }

  /** Run a query whose rows are all nodes, returning serialised dicts. */
  async nodes(cypher: string, params: Record<string, unknown> = {}): Promise<BrainNode[]> {
    const rows = await this.query(cypher, params);
    const out: BrainNode[] = [];
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (isRawNode(value)) out.push(nodeToDict(value));
      }
    }
    return out;
  }

  async deleteGraph(): Promise<void> {
    try {
      await withTimeout(this.graph.delete(), queryTimeoutMs(), "graph delete");
    } catch {
      // A fresh FalkorDB has no graph to delete; that is not an error here.
    }
  }

  /** Close the underlying connection (used by scripts/tests to exit cleanly). */
  async close(): Promise<void> {
    try {
      await this.db.close();
    } catch {
      // already closed
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.query("RETURN 1");
      return true;
    } catch {
      return false;
    }
  }

  private log(cypher: string, params: Record<string, unknown>, rows: number, ms: number): void {
    if (process.env.BRAIN_QUERY_LOG !== "1") return;
    const brief = Object.entries(params)
      .map(([k, v]) =>
        Array.isArray(v) && v.length > 4 ? `${k}=[${v.length} rows]` : `${k}=${String(v).slice(0, 160)}`,
      )
      .join(", ");
    console.info(
      `[brain] cypher (${ms}ms, ${rows} rows): ${cypher.replace(/\s+/g, " ").trim().slice(0, 200)} | ${brief}`,
    );
  }
}
