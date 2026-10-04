import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpCezarClient } from "../../src/cezar/http-client.js";
import { CezarError } from "../../src/core/contracts.js";
import { fixtureServer, json, fixtureRun } from "../fixtures/server.js";
const ref = { projectId: "demo", runId: "run-1" };
const unknown = (e: unknown) =>
  e instanceof CezarError &&
  e.detail.code === "outcome_unknown" &&
  e.detail.outcome === "unknown";
test("accepted writes with disconnect, malformed success or timeout are attempted once", async () => {
  for (const mode of ["disconnect", "schema", "timeout"]) {
    const fixture = await fixtureServer((req, res) => {
      if (req.method === "POST") {
        if (mode === "disconnect") res.destroy();
        else if (mode === "schema") json(res, { accepted: "unexpected shape" });
        return true;
      }
    });
    const client = new HttpCezarClient({
      url: fixture.url,
      mutationTimeoutMs: 30,
    });
    try {
      await assert.rejects(client.sendMessage(ref, "/skill exact"), unknown);
      assert.equal(
        fixture.requests.filter((r) => r.method === "POST").length,
        1,
      );
    } finally {
      client.close();
      await fixture.close();
    }
  }
});
test("cancellation before send makes no mutation; cancellation after send is unknown", async () => {
  let accepted!: () => void;
  const didAccept = new Promise<void>((r) => {
    accepted = r;
  });
  const fixture = await fixtureServer((req, _res) => {
    if (req.method === "POST") {
      accepted();
      return true;
    }
  });
  const client = new HttpCezarClient({ url: fixture.url });
  try {
    const before = new AbortController();
    before.abort();
    await assert.rejects(client.sendMessage(ref, "exact", before.signal));
    assert.equal(fixture.requests.filter((r) => r.method === "POST").length, 0);
    const after = new AbortController();
    const pending = client.sendMessage(ref, "exact", after.signal);
    await didAccept;
    after.abort();
    await assert.rejects(pending, unknown);
    assert.equal(fixture.requests.filter((r) => r.method === "POST").length, 1);
  } finally {
    client.close();
    await fixture.close();
  }
});
test("delivery variants and closed-session refusal never trigger continuation", async () => {
  const outcomes = [
    { delivered: true },
    { deferred: true },
    { queued: true, message: { id: "queued", createdAt: "now" } },
    { error: "session closed" },
  ];
  let index = 0;
  const fixture = await fixtureServer((req, res) => {
    if (req.url?.endsWith("/messages")) {
      const value = outcomes[index++];
      json(res, value, index === 4 ? 409 : 200);
      return true;
    }
  });
  const client = new HttpCezarClient({ url: fixture.url });
  try {
    for (const expected of outcomes.slice(0, 3))
      assert.deepEqual(
        await client.sendMessage(ref, "  /skill\nline"),
        expected,
      );
    await assert.rejects(
      client.sendMessage(ref, "x"),
      (e) =>
        e instanceof CezarError &&
        e.detail.code === "conflict" &&
        e.detail.outcome === "rejected",
    );
    assert.equal(
      fixture.requests.some((r) => r.url.endsWith("/continue")),
      false,
    );
  } finally {
    client.close();
    await fixture.close();
  }
});
test("wrong identity after PATCH and server failure after write remain unknown", async () => {
  const fixture = await fixtureServer((req, res) => {
    if (req.method === "PATCH") {
      json(res, fixtureRun("different"));
      return true;
    }
    if (req.method === "POST") {
      json(res, { error: "crashed after commit" }, 500);
      return true;
    }
  });
  const client = new HttpCezarClient({ url: fixture.url });
  try {
    await assert.rejects(client.updateTask(ref, { title: "x" }), unknown);
    await assert.rejects(client.cancelTask(ref), unknown);
  } finally {
    client.close();
    await fixture.close();
  }
});
test("HTTP overflow aborts rather than producing partial JSON or write success", async () => {
  const fixture = await fixtureServer((req, res) => {
    if (req.url?.endsWith("/history") || req.method === "POST") {
      res.end("x".repeat(8 * 1024 * 1024 + 1));
      return true;
    }
  });
  const client = new HttpCezarClient({ url: fixture.url });
  try {
    await assert.rejects(
      client.readMessages(ref),
      (e) => e instanceof CezarError && e.detail.code === "response_too_large",
    );
    await assert.rejects(client.sendMessage(ref, "x"), unknown);
  } finally {
    client.close();
    await fixture.close();
  }
});
