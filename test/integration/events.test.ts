import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { HttpCezarClient } from "../../src/cezar/http-client.js";
import { createToolHandlers } from "../../src/core/tools.js";
import type { WatchBaseline } from "../../src/core/contracts.js";
import { CezarError } from "../../src/core/contracts.js";
import { consumeSse } from "../../src/cezar/events.js";
import {
  fixtureServer,
  fixtureRun,
  fixtureHistory,
  json,
} from "../fixtures/server.js";
const ref = { projectId: "demo", runId: "run-1" };
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventFixture(mode = "normal") {
  const runs = new Map([
    ["run-1", fixtureRun()],
    ["run-2", fixtureRun("run-2")],
  ]);
  const streams = new Map<string, ServerResponse>();
  let active = 0;
  const fixture = await fixtureServer((req, res) => {
    const match = /\/runs\/([^/?]+)(?:\/([^?]+))?/.exec(req.url ?? "");
    if (!match) return;
    const id = match[1]!;
    const run = runs.get(id);
    if (match[2] === "events") {
      if (mode === "missing") {
        json(res, { error: "not found" }, 404);
        return true;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.flushHeaders();
      active++;
      streams.set(id, res);
      res.once("close", () => {
        active--;
        streams.delete(id);
      });
      if (mode === "malformed") res.write("event: run-event\ndata: {bad}\n\n");
      else if (mode === "overflow")
        res.write(`data: ${"x".repeat(1024 * 1024 + 1)}\n\n`);
      else if (mode === "disconnect") res.end();
      else res.write(`event: run\ndata: ${JSON.stringify(run)}\n\n`);
      return true;
    }
    if (match[2] === "history") {
      json(res, fixtureHistory);
      return true;
    }
    if (!match[2]) {
      json(res, run);
      return true;
    }
  });
  const client = new HttpCezarClient({ url: fixture.url });
  const baseline = (id = "run-1"): WatchBaseline => ({
    ...ref,
    runId: id,
    afterSeq: 1,
    state: client.watchState(runs.get(id)!),
  });
  return {
    ...fixture,
    client,
    runs,
    streams,
    baseline,
    active: () => active,
    finish: async () => {
      client.close();
      await fixture.close();
    },
  };
}
test("unchanged terminal snapshot times out and releases the subscription", async () => {
  const f = await eventFixture();
  f.runs.set("run-1", fixtureRun("run-1", { status: "done" }));
  try {
    const result = await f.client.waitForEvents([f.baseline()], 40);
    assert.equal(result.timedOut, true);
    assert.deepEqual(result.observations[0]?.kinds, []);
    await delay(10);
    assert.equal(f.active(), 0);
  } finally {
    await f.finish();
  }
});
test("two workers coalesce replay and semantic changes into client-held baselines", async () => {
  const f = await eventFixture();
  try {
    const waiting = f.client.waitForEvents(
      [f.baseline(), f.baseline("run-2")],
      500,
    );
    while (f.streams.size < 2) await delay(1);
    f.streams
      .get("run-1")!
      .write(
        `event: run-event\ndata: ${JSON.stringify({ seq: 2, ts: "now", type: "assistant", text: "complete" })}\n\n`,
      );
    f.runs.set("run-2", fixtureRun("run-2", { status: "review" }));
    f.streams
      .get("run-2")!
      .write(
        `event: run\ndata: ${JSON.stringify(fixtureRun("run-2", { status: "review" }))}\n\n`,
      );
    const result = await waiting;
    assert.equal(result.timedOut, false);
    assert.ok(result.observations[0]?.kinds.includes("transcript_available"));
    assert.ok(result.observations[1]?.kinds.includes("state_changed"));
    assert.equal(result.observations[0]?.baseline?.afterSeq, 2);
    await delay(10);
    assert.equal(f.active(), 0);
  } finally {
    await f.finish();
  }
});
test("ephemeral deltas never advance a durable watermark or count as transcript change", async () => {
  const f = await eventFixture();
  try {
    const waiting = f.client.waitForEvents([f.baseline()], 80);
    while (!f.streams.size) await delay(1);
    f.streams
      .get("run-1")!
      .write(
        'event: ui-event\ndata: {"seq":900,"ts":"now","type":"item.delta","delta":"token"}\n\n',
      );
    const result = await waiting;
    assert.equal(result.timedOut, true);
    assert.equal(result.observations[0]?.baseline?.afterSeq, 1);
  } finally {
    await f.finish();
  }
});
test("ambiguous item.updated uses durable history rather than ephemeral sequence", async () => {
  const f = await eventFixture();
  try {
    const waiting = f.client.waitForEvents([f.baseline()], 80);
    while (!f.streams.size) await delay(1);
    f.streams
      .get("run-1")!
      .write(
        'event: ui-event\ndata: {"seq":900,"ts":"now","type":"item.updated","item":{}}\n\n',
      );
    const result = await waiting;
    assert.equal(result.timedOut, true);
    assert.equal(result.observations[0]?.baseline?.afterSeq, 1);
  } finally {
    await f.finish();
  }
});
test("future sequence and wrong task binding demand resynchronization", async () => {
  const f = await eventFixture();
  try {
    const future = await f.client.waitForEvents(
      [{ ...f.baseline(), afterSeq: 999 }],
      200,
    );
    assert.equal(future.observations[0]?.error?.code, "resync_required");
    const wrong = await f.client.waitForEvents(
      [{ ...f.baseline(), runId: "other" }],
      200,
    );
    assert.ok(wrong.observations[0]?.error);
  } finally {
    await f.finish();
  }
});
test("stream loss, malformed frames, overflow and deletion become per-watch errors", async () => {
  for (const mode of ["disconnect", "malformed", "overflow", "missing"]) {
    const f = await eventFixture(mode);
    try {
      const result = await f.client.waitForEvents([f.baseline()], 200);
      assert.ok(result.observations[0]?.error, mode);
      await delay(10);
      assert.equal(f.active(), 0);
    } finally {
      await f.finish();
    }
  }
});
test("one wait per connection; ordinary reads remain available; cancellation releases lock and streams", async () => {
  const f = await eventFixture();
  const handle = createToolHandlers(f.client);
  const abort = new AbortController();
  try {
    const waiting = handle(
      "wait_for_events",
      { watches: [f.baseline()], timeoutMs: 500 },
      abort.signal,
    );
    while (!f.streams.size) await delay(1);
    const second = await handle("wait_for_events", {
      watches: [f.baseline()],
      timeoutMs: 10,
    });
    assert.equal(second.structuredContent.ok, false);
    if (!second.structuredContent.ok)
      assert.equal(second.structuredContent.error.code, "wait_in_progress");
    assert.equal((await handle("get_task", ref)).structuredContent.ok, true);
    abort.abort();
    const cancelled = await waiting;
    assert.equal(cancelled.structuredContent.ok, false);
    await delay(10);
    assert.equal(f.active(), 0);
    const next = await handle("wait_for_events", {
      watches: [f.baseline()],
      timeoutMs: 0,
    });
    assert.equal(next.structuredContent.ok, true);
    assert.equal(
      f.requests.some((r) => r.url.endsWith("/cancel")),
      false,
    );
  } finally {
    await f.finish();
  }
});
test("full report/question digests detect changes beyond displayed previews and are deterministic", () => {
  const client = new HttpCezarClient();
  const a = fixtureRun("r", {
    dispatch: {
      rootRunId: "r",
      pendingAsk: { questions: ["x".repeat(10000) + "a"], askedAt: "now" },
    },
  });
  const b = fixtureRun("r", {
    dispatch: {
      rootRunId: "r",
      pendingAsk: { askedAt: "now", questions: ["x".repeat(10000) + "b"] },
    },
  });
  assert.notEqual(
    client.watchState(a).questionDigest,
    client.watchState(b).questionDigest,
  );
  assert.equal(
    client.watchState(a).questionDigest,
    client.watchState({ ...a }).questionDigest,
  );
  client.close();
});
test("incremental SSE handles split UTF-8, CRLF and multiline data", async () => {
  const encoded = new TextEncoder().encode(
    "event: example\r\ndata: 😀\r\ndata: value\r\n\r\n",
  );
  const frames: unknown[] = [];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const b of encoded) controller.enqueue(Uint8Array.of(b));
        controller.close();
      },
    }),
  );
  await assert.rejects(
    consumeSse(response, (frame) => frames.push(frame)),
    (e) => e instanceof CezarError && e.detail.code === "resync_required",
  );
  assert.deepEqual(frames, [{ event: "example", data: "😀\nvalue" }]);
});

test("an initial stream snapshot cannot replace the newer authoritative task", async () => {
  const f = await eventFixture();
  const baseline = f.baseline();
  const original = f.client.getTask.bind(f.client);
  let reads = 0;
  f.client.getTask = async (...args) => {
    if (++reads === 1) {
      await delay(10);
      f.runs.set("run-1", fixtureRun("run-1", { status: "review" }));
    }
    return original(...args);
  };
  try {
    const result = await f.client.waitForEvents([baseline], 500);
    assert.equal(result.observations[0]?.baseline?.state.status, "review");
    assert.ok(result.observations[0]?.kinds.includes("state_changed"));
  } finally {
    await f.finish();
  }
});
