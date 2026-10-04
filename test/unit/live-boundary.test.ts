import { test } from "node:test";
import assert from "node:assert/strict";
import { historyWire, runWire } from "../../src/cezar/wire.js";
import { fixtureRun } from "../fixtures/server.js";
import { HttpCezarClient } from "../../src/cezar/http-client.js";
test("pinned history itemCount counts canonical items, not raw transcript envelopes", () => {
  const events = Array.from({ length: 150 }, (_, seq) => ({
    seq,
    ts: "now",
    type: "user-message",
    text: "x",
  }));
  const page = historyWire.parse({
    events,
    itemCount: 100,
    asOfSeq: 149,
    hasOlder: true,
    liveCursor: "opaque",
  });
  assert.equal(page.events.length, 150);
  assert.equal(page.itemCount, 100);
});
test("cezar current step is optional identity, and hidden usage does not change semantic state", () => {
  const run = runWire.parse(
    fixtureRun("r", {
      steps: [
        {
          id: "s",
          name: "Implement",
          kind: "agent",
          status: "running",
          tokensUsed: 1,
        },
      ],
      currentStepId: "s",
    }),
  );
  assert.equal(run.currentStepId, "s");
  const client = new HttpCezarClient();
  const first = client.watchState(run);
  const second = client.watchState({
    ...run,
    steps: [{ ...run.steps[0]!, tokensUsed: 900, costUsd: 25 }],
  });
  assert.deepEqual(first, second);
  client.close();
});

test("ordinary root pending questions are projected from validated history and clear on a reply", async () => {
  const { pendingQuestion } = await import("../../src/core/questions.js");
  const run = fixtureRun();
  const page = {
    events: [
      {
        seq: 2,
        ts: "now",
        type: "ask.requested",
        payload: {
          requestId: "q",
          questions: [{ question: "Choose?", options: [{ label: "A" }] }],
          extra: "stripped",
        },
      },
    ],
    itemCount: 1,
    asOfSeq: 2,
    liveCursor: "opaque",
    hasOlder: false,
  };
  assert.deepEqual(pendingQuestion(run, page), {
    requestId: "q",
    questions: [{ question: "Choose?", options: [{ label: "A" }] }],
    askedAt: "now",
  });
  page.events.push({
    seq: 3,
    ts: "later",
    type: "user-message",
    payload: { text: "A" } as never,
  });
  assert.equal(pendingQuestion(run, page), undefined);
});
