/**
 * Ask-user question registry tests.
 *
 * The pause is the whole feature: a tool call blocks mid-turn until a human
 * answers, a stopped run releases the model, and an unanswered question never
 * reads as approval. Run: `npm run test:ui`
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  askUser,
  answerUser,
  getQuestion,
  cancelRunQuestions,
  forgetRun,
} from "../../lib/ask-user";

const Q = [{ id: "q1", question: "Proceed with the cleanup?" }];

describe("askUser", () => {
  it("resolves with the answers the user submitted", async () => {
    const call = askUser("call-1", "conv-1", Q);
    assert.equal(getQuestion("call-1")?.status, "pending");
    answerUser("call-1", [{ id: "q1", selected: ["Yes"], custom: "now" }]);
    assert.deepEqual(await call, [
      { id: "q1", selected: ["Yes"], custom: "now" },
    ]);
    // Settled questions are reaped, so a late double-submit is a no-op.
    assert.equal(getQuestion("call-1"), null);
  });

  it("rejects a second answer for the same question", async () => {
    const call = askUser("call-2", "conv-1", Q);
    assert.ok(answerUser("call-2", [{ id: "q1", selected: ["A"] }]));
    assert.equal(answerUser("call-2", [{ id: "q1", selected: ["B"] }]), null);
    assert.deepEqual(await call, [{ id: "q1", selected: ["A"] }]);
  });

  it("releases the model when the run stops", async () => {
    const call = askUser("call-3", "conv-1", Q, "run-x");
    cancelRunQuestions("run-x");
    // Empty, never an approval: the tool description tells the model an empty
    // answer means 'not approved'.
    assert.deepEqual(await call, []);
    forgetRun("run-x");
  });

  it("ignores a stop for a run that owns no question", () => {
    cancelRunQuestions("run-unknown");
    assert.equal(getQuestion("call-unknown"), null);
  });

  it("joins a repeated call rather than stacking a second question", async () => {
    // A resumed turn re-executes the same tool call; the user must still only
    // ever see (and answer) one question.
    const first = askUser("call-4", "conv-1", Q);
    const second = askUser("call-4", "conv-1", Q);
    answerUser("call-4", [{ id: "q1", selected: ["Yes"] }]);
    assert.deepEqual(await first, [{ id: "q1", selected: ["Yes"] }]);
    assert.deepEqual(await second, [{ id: "q1", selected: ["Yes"] }]);
  });

  it("keeps distinct questions independent", async () => {
    const a = askUser("call-a", "conv-1", Q);
    const b = askUser("call-b", "conv-1", Q);
    answerUser("call-b", [{ id: "q1", selected: ["B"] }]);
    assert.deepEqual(await b, [{ id: "q1", selected: ["B"] }]);
    assert.equal(getQuestion("call-a")?.status, "pending");
    answerUser("call-a", [{ id: "q1", selected: ["A"] }]);
    assert.deepEqual(await a, [{ id: "q1", selected: ["A"] }]);
  });
});