/**
 * Intent classification — decide *what kind of turn* this is before touching
 * the graph.
 *
 * Without this, "hi" and "what can you do?" get planned as graph queries,
 * return nothing, and the user gets "I could not find anything in the graph for
 * that question" — which is technically true and completely useless.
 *
 * Four intents:
 *   conversational  greetings, thanks, farewells       → answer directly, no tools
 *   capability      "what can you do?", "who are you?" → answer from the LIVE graph
 *   graph           a real question about the org      → run researcher/synthesizer
 *   unknown         neither                            → ask what they want to know
 *
 * Deliberately deterministic and regex-based: this runs before any model call,
 * so it costs nothing, cannot hallucinate a category, and behaves identically
 * in tests and in the demo.
 */

export const CONVERSATIONAL = "conversational";
export const CAPABILITY = "capability";
export const GRAPH = "graph";
export const UNKNOWN = "unknown";

export type IntentKind = typeof CONVERSATIONAL | typeof CAPABILITY | typeof GRAPH | typeof UNKNOWN;

export type Intent = { kind: IntentKind; reason: string; is_graph: boolean };

const GREETING =
  /^\s*(hi|hey|hello|yo|hiya|good\s+(morning|afternoon|evening)|howdy|greetings|namaste)\b[\s!.?]*$/i;
const THANKS =
  /^\s*(thanks?|thank\s+you|ta|cheers|nice|perfect|great|awesome|cool|good\s+(job|work)|appreciate\s+it)\b[\s!.?]*$/i;
const FAREWELL =
  /^\s*(bye|goodbye|see\s+(you|ya)|cya|later|gtg|good\s+night)\b[\s!.?]*$/i;
const POLITE = /^\s*(please|ok|okay|sure|got it|understood|cool)\b[\s!.?]*$/i;

const CAPABILITY_RE =
  /\b(what can you do|what can (i|we) (ask|do)|who are you|what are you|how do you work|what do you know|help|how do i use|what is this|introduce yourself|what can this do)\b/i;

const ID_LOOKUP = /\b(service|person|ticket|decision|document|message|team|repo):/i;
const TICKET_KEY = /\bMER-\d{3,5}\b/i;

const EXPLORE =
  /\b(something|anything|anything interesting|surprise me|show me|give me|tell me about|what do you know|anything notable|what.s going on|what.s happening|summary|overview|highlights?)\b/i;

function mk(kind: IntentKind, reason: string): Intent {
  return { kind, reason, is_graph: kind === GRAPH || kind === UNKNOWN };
}

/** Classify a user turn. Pure, cheap, and never calls a model. */
export function classify(question: string): Intent {
  const text = (question ?? "").trim();
  if (!text) return mk(CONVERSATIONAL, "empty message");

  // Explicit ids are always a graph lookup, even if they contain "thanks".
  if (ID_LOOKUP.test(text) || TICKET_KEY.test(text)) return mk(GRAPH, "explicit node id");

  if (GREETING.test(text)) return mk(CONVERSATIONAL, "greeting");
  if (THANKS.test(text)) return mk(CONVERSATIONAL, "thanks");
  if (FAREWELL.test(text)) return mk(CONVERSATIONAL, "farewell");
  if (POLITE.test(text) && text.split(/\s+/).length <= 3) {
    return mk(CONVERSATIONAL, "acknowledgement");
  }
  if (CAPABILITY_RE.test(text)) return mk(CAPABILITY, "asks what this can do");

  // A single bare word ("auth", "payments") is a real graph lookup.
  const words = text.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? [];
  if (words.length === 1 && words[0].length > 2) return mk(GRAPH, "bare entity name");

  if (EXPLORE.test(text) && words.length <= 6) return mk(GRAPH, "open-ended exploration");

  // Anything that looks like a question, an imperative, or a request to act
  // on the graph gets the graph path.
  if (
    text.endsWith("?") ||
    /^\s*(who|what|when|where|which|how|why|list|show|find|get|tell|file|create|open|assign|update|close|reopen|record|note|remember|page|escalate)/i.test(text)
  ) {
    return mk(GRAPH, "question form");
  }

  return mk(UNKNOWN, "no clear signal");
}

// ---------------------------------------------------------------------------
// Replies for the non-graph intents
// ---------------------------------------------------------------------------

export const EXAMPLES = [
  "Which tickets are blocked by the auth migration?",
  "If notifications-service goes down, what breaks?",
  "Who knows the auth system?",
  "What did we decide about the database, and why?",
  "Which services are bottlenecks?",
];

export function greetingReply(name?: string | null): string {
  const who = name ? `, ${name}` : "";
  return (
    `Hello${who}. I'm the Company Brain for Meridian — I answer questions ` +
    "about this engineering org by traversing a graph of people, teams, " +
    "services, tickets, decisions and chat. Ask me something like " +
    `“${EXAMPLES[0]}”`
  );
}

/** Answer "what can you do?" from the LIVE graph, not from a canned list. */
export function capabilityReply(graphStats?: {
  node_counts: Record<string, number>;
  edge_counts: Record<string, number>;
} | null): string {
  const lines = [
    "I answer questions about this engineering org by querying a graph in " +
      "FalkorDB. Every answer ships with the queries it ran and the nodes it " +
      "touched, so you can check my reasoning.",
    "",
    "Things worth asking:",
    ...EXAMPLES.map((ex) => `  • ${ex}`),
    "",
    "I also remember: what you asked earlier in this workspace is consolidated " +
      "into memory, and I re-use procedures I have learned for these kinds of " +
      "questions.",
  ];
  if (graphStats) {
    const nodes = graphStats.node_counts ?? {};
    const edges = graphStats.edge_counts ?? {};
    if (Object.keys(nodes).length > 0) {
      const parts = Object.entries(nodes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ");
      const totalNodes = Object.values(nodes).reduce((a, b) => a + b, 0);
      const totalEdges = Object.values(edges).reduce((a, b) => a + b, 0);
      lines.push(
        "",
        `Right now the graph holds ${totalNodes} nodes (${parts}) and ${totalEdges} edges.`,
      );
    }
  }
  return lines.join("\n");
}

export function unknownReply(contextHint?: string | null): string {
  const base =
    "I can't help with that — I know this engineering org, not the wider " +
    "world. I'm connected to its graph of people, services, tickets, " +
    "decisions and chat.";
  if (contextHint) return `${base}\n\nA good question here looks like: ${contextHint}`;
  return `${base}\n\nA good question here looks like: “${EXAMPLES[1]}”`;
}

// ---------------------------------------------------------------------------
// Out-of-scope questions — dead ends are worse than denials
// ---------------------------------------------------------------------------

const OUT_OF_SCOPE =
  /\b(time|date|weather|poem|joke|recipe|song|lyrics|story|math|calculate|translate|news|election|president|capital of|who is the president|what is (the )?(time|date|weather))\b/i;

const WHO_IS_PERSONAL = /^\s*who is ([a-z][a-z \-']{2,40})\s*\??\s*$/i;

/** True for things this product will never answer: time, jokes, news, … */
export function isClearlyOutOfScope(question: string): boolean {
  return OUT_OF_SCOPE.test(question ?? "");
}

/** Pull a candidate person name out of a "who is X?" so it can be looked up. */
export function extractNameGuess(question: string): string | null {
  const m = WHO_IS_PERSONAL.exec(question ?? "");
  return m ? m[1].trim() : null;
}
