import { test } from "node:test";
import assert from "node:assert/strict";
import {
  success,
  jsonBytes,
  historyEvent,
  taskSummary,
} from "../../src/core/output.js";
import { fixtureRun } from "../fixtures/server.js";
test("100 multibyte history identities survive the total output cap", () => {
  const events = Array.from({ length: 100 }, (_, i) => ({
    seq: i + 1,
    ts: "now",
    type: "assistant",
    payload: { text: "😀".repeat(20000) },
  }));
  const result = success(
    {
      events,
      itemCount: 100,
      liveCursor: "opaque",
      asOfSeq: 100,
      hasOlder: false,
    },
    "read_messages complete",
  );
  assert.ok(jsonBytes(result) < 65536);
  assert.equal(result.structuredContent.truncated, true);
  assert.equal((result.structuredContent.data.events as unknown[]).length, 100);
  assert.equal(result.structuredContent.data.liveCursor, "opaque");
});
test("byte-limited collection offset identifies the first omitted row", () => {
  const result = success(
    {
      tasks: Array.from({ length: 100 }, (_, i) => ({
        runId: String(i),
        title: "😀".repeat(3000),
      })),
      offset: 20,
      nextOffset: 120,
      hasMore: true,
    },
    "tasks",
  );
  const data = result.structuredContent.data;
  assert.equal(data.nextOffset, 20 + (data.tasks as unknown[]).length);
  assert.equal(data.hasMore, true);
});
test("hidden usage and costs are removed from summaries and known/unknown history payloads", () => {
  const caps = {
    dispatch: true,
    tokenMetrics: false,
    tokenUsageMetrics: false,
    costMetrics: false,
  };
  const run = taskSummary(
    fixtureRun("run-1", { costUsd: 3, tokensUsed: 8 }),
    { projectId: "demo", runId: "run-1" },
    { targetUrl: "http://127.0.0.1:4321", capabilities: caps },
  );
  assert.equal("costUsd" in run, false);
  assert.equal("tokensUsed" in run, false);
  const event = historyEvent(
    {
      seq: 1,
      ts: "now",
      type: "assistant",
      payload: { text: "ok", usage: { inputTokens: 8 }, costUsd: 3 },
    },
    caps,
  );
  assert.deepEqual(event.payload, { text: "ok" });
  assert.deepEqual(
    historyEvent(
      { seq: 2, ts: "now", type: "future", payload: { mystery: 3 } },
      caps,
    ).payload,
    { omitted: true, reason: "metric_visibility" },
  );
});
