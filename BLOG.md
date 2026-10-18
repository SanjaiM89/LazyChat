# The graph was the product: building an Engineering Company Brain on FalkorDB

*Submitted for the Graph Hacks blog prize.*

---

Most "AI knows about our company" demos are a search box with a language model
behind it. You ask a question, it runs a similarity search over some embedded
documents, and it writes a paragraph. It is impressive in a demo and falls apart
in real use, for one reason: **the interesting questions about an engineering
organisation are not similarity problems. They are structural problems.**

"Who knows the auth system?" is not a document-retrieval question. It is a
question about a subgraph.

"Which tickets are blocked by the auth migration?" is not a text question. The
word "auth" appears in dozens of ticket titles, Slack messages and RFCs. What
makes the answer correct is an *edge* — each blocked ticket points at the
decision that gates it — and that edge exists nowhere except in the graph.

"If the notifications service goes down, what breaks?" has no answer in any
document. It is the result of walking `DEPENDS_ON` edges in reverse.

So we built the product around the assumption that the graph is not an
implementation detail behind the LLM. **The graph is the context layer, and the
agent is a traversal planner that cites its steps.**

---

## The data model was designed backwards from the questions

We started by writing down the four questions the demo must answer, and only
then designed the schema to make them one traversal each.

The company is "Meridian", a fictional payments startup: 4 teams, 20 people,
10 services, 9 repositories, 30 tickets, 20 documents, 15 architecture
decisions, 50 chat messages. All synthetic, generated from a script that
refuses to seed if its own referential integrity check fails.

The schema that fell out:

```
(:Person)-[:MEMBER_OF]->(:Team)-[:OWNS]->(:Service)-[:DEPENDS_ON]->(:Service)
                                  ^                   ^            |
                            (:Service)        (:Person)-[:KNOWS_ABOUT {level}]
                                  |                            |
                     (:Ticket)-[:RELATES_TO]           (:Decision)
                                  |                            ^
                                  +------[:BLOCKED_BY]----------+
```

Three decisions in there are worth defending.

### 1. `BLOCKED_BY` points at both tickets *and* decisions

Our first dataset only had `Ticket-[:BLOCKED_BY]->Ticket`: ticket B waits for
ticket A. That is true but it answers nothing interesting. *"Which tickets are
blocked by the auth migration?"* is a question about a **decision**.

So we added `Ticket-[:BLOCKED_BY]->Decision`. The Auth v3 decision now blocks
seven tickets — across seven different services and two different teams. One
traversal, and the answer is genuinely multi-hop: *ticket → decision → service →
team*.

This was a bug we only found by testing the question, not by reading the code.
The seed script reported `BLOCKED_BY: 10` and the loader exited successfully,
but the query returned **zero rows** — because tickets were seeded *before*
decisions, so every `MERGE` matched nothing and silently wrote nothing.

That failure mode is worth dwelling on. `MERGE` with a missing endpoint is not an
error in Cypher; it is a no-op. A seeding script that reports success while
writing nothing is the worst kind of bug, so the seeder now ends by re-counting
every node and edge against counts derived from the dataset and **fails the run
on any mismatch**. The 98-test suite inherits that guarantee.

### 2. `DEPENDS_ON` is runtime direction, and blast radius is a *reverse* traversal

`payments-api DEPENDS_ON auth-service` means an auth outage breaks payments. So
"What breaks if notifications goes down?" is
`(affected)-[:DEPENDS_ON*1..5]->(root)`. Getting this backwards produces a
confident, completely wrong answer, which is why the direction is called out
explicitly in the schema doc rather than left to be inferred.

### 3. `DISCUSSED_IN` points *from* the message

Track 3 of this hackathon demands sourced answers. A decision's `rationale`
field is a summary, and a summary is an assertion. Being able to say *"this is
what we decided, and here is the Slack thread where we argued about it"* is a
genuinely different claim. So `Message-[:DISCUSSED_IN]->Decision` exists, and the
agent surfaces the thread alongside the rationale.

Our first seed data had no message→decision links at all, which quietly made
"sourced" impossible. Adding `DECISION_DISCUSSION` (13 of 15 decisions) is what
turned the sourcing claim from decorative into real.

---

## The agent plans, but it cannot lie

The agent has 15 tools and no way to touch the graph except through them. That
constraint is the product.

```
question
  └─ recall memory          ← prior sessions for this user, from the graph
  └─ Researcher             ← plans tools, runs Cypher, writes :Finding nodes
  └─ AgentHandoff           ← researcher → synthesizer, -[:RECORDED]-> findings
  └─ Synthesizer            ← composes using findings + memory, nothing else
  └─ { answer, reasoning_trace, graph_context, sources }
```

Three properties fall out of this design.

**The handoff is a node, not a variable.** `AgentHandoff` is a row in FalkorDB
with a reason string and edges to the findings it carried. That means the
coordination between two agents is queryable, countable, and inspectable in the
UI *after the fact*. A handoff passed in a Python local variable leaves no
evidence that it happened.

**Each tool returns a summary *and* the Cypher that produced it.** Not either —
both. That pairing is what the reasoning trace renders, so a user can read
`MATCH (d:Decision) WHERE … any(t IN d.topics WHERE …)` and check the claim
themselves. An LLM that says "trust me" is not explainable; one that shows the
query is.

**Memory lives in the same graph as the company data.** `Session`, `Turn`,
`EpisodicMemory`, `SemanticMemory`, `ProceduralMemory` are all nodes. Recall is
a Cypher query, and it is deliberately *lexical* rather than vector-based — it
needs no embedding service, and it means the trace can show exactly which memory
node was recalled and why. Every memory node carries `user_id` and every read
filters on it, so two users asking the same question cannot see each other's
history. There is a test that asserts precisely that.

---

## Two bugs that shaped the design more than any feature

**Topic extraction.** The offline planner originally stripped stopwords from the
question to build a search term. "Which tickets are blocked by the auth
migration?" produced the term `"tickets blocked auth migration"`, which matched
nothing, and the agent helpfully reported "no tickets are blocked". The fix was
to stop guessing the vocabulary from English and instead **load the graph's own
vocabulary** — `Service.aliases` and `Decision.topics` — and match the question
against *that*. "auth migration" hits the `auth` topic, which hits the Auth v3
decision. The schema gained two properties (`Service.aliases`, `Decision.topics`)
purely so the agent would have something to match against. That is a data-model
decision driven by a retrieval problem, which is the kind of coupling that is
easy to miss if you design the schema and the agent separately.

**Findings were not scoped per turn.** The Synthesizer read *every* finding the
Researcher had written in the session. Ask the database question after the auth
question and the answer restated the auth answer first. We caught this by
running the demo script and reading the output, not by testing — the function was
individually correct. The fix was a `turn_ref` stamped on every `Finding`, so each
answer rests only on evidence gathered for *that* question. There is now a
regression test that asserts the second answer does not contain `MER-1002`.

---

## What FalkorDB gave us that we did not have to build

`algo.betweenness`, `algo.HarmonicCentrality`, `algo.labelPropagation` and
`algo.pageRank` are built in. We found them by introspecting `dbms.procedures()`
rather than assuming — after discovering that the two-argument form
`algo.betweenness(null, {...})` is rejected by this server version and only the
single config-map argument works.

Betweenness is a better answer to "which service should we fix first?" than
anything we would have hand-rolled. `event-pipeline` scores 3.5 — it genuinely
sits on the most shortest paths. Harmonic centrality then tells a different
story (`web-checkout` is closest to everything on average), which is exactly why
both exist: PageRank rewards degree, betweenness rewards brokerage, harmonic
rewards proximity. Asking the agent "which service is the bottleneck?" and
routing it to betweenness, rather than grepping for "critical", is the whole
argument for tools over prompts.

Community detection was the one we had to shape. Out of the box `labelPropagation`
returned clusters like "Message: 50 nodes" — technically a community, useless as
an insight. The fix was to stop treating the label as the community and resolve
each node's **home team** through `MEMBER_OF`, `OWNS`, `RELATES_TO` and
`AUTHORED`. Clusters became Platform (58 nodes), Payments & Billing (44), Data &
ML (25), Growth & Activation (22). That is an org chart, discovered from the
graph rather than declared in it.

---

## The unglamorous part: it has to run without an API key

A demo that needs a paid API key is a demo that breaks on stage. So the agent
runs behind an `LLMClient` interface with two implementations, and the fallback is
not a stub that returns canned strings.

`MockLLM` speaks the same tool-calling protocol Claude uses. It loads the graph's
vocabulary, picks tools, dispatches them, and composes an answer **strictly from
tool output**. The entire product — reasoning trace, contributing subgraph,
multi-agent handoff, memory recall — is exercised offline, which is why the test
suite runs with no network and no key. Set `ANTHROPIC_API_KEY` and the identical
loop runs against real Claude with native tool use.

This turned out to be the highest-leverage engineering decision in the project.
It made the whole pipeline testable, and it made bugs like the turn-scoped
findings and the mis-ordered seed visible in seconds rather than at the end.

---

## What I would do next

- **Subgraph retrieval before the planner runs.** Fetch a small neighbourhood of
  candidate entities and put it in the system prompt. Today the agent plans from
  labels alone and only then looks at data.
- **Vector recall alongside lexical recall.** Lexical is inspectable and free,
  but it misses paraphrases. Both, with the trace showing which one fired.
- **Write-back.** The agent can read the graph and write memory; letting it also
  propose `Finding`s that a human promotes into `Decision` nodes closes the loop
  from the company brain back into the company record.
- **Push the `verify()` idea everywhere.** It caught the only silent failure in
  the system. A graph whose writes can no-op is a graph that will lie to you.

---

## The lesson

An LLM is very good at turning intent into a query and very bad at knowing what
is true. Those are complementary, not competing, skills.

Put the graph underneath, make the agent's only access to it a set of tools that
each return their own query and their own evidence, and you get a system where
"the AI made that up" stops being a thing you have to wonder about — because
every sentence in the answer has a row behind it that you can go and look at.
