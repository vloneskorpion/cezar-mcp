import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpCezarClient } from "../../src/cezar/http-client.js";
import { createToolHandlers } from "../../src/core/tools.js";
import { fixtureServer, json, fixtureRun } from "../fixtures/server.js";
test("scoped reads and baseline preserve concrete identity and reject unknown scope", async () => {
  const fixture = await fixtureServer();
  const client = new HttpCezarClient({ url: fixture.url });
  try {
    const handle = createToolHandlers(client);
    const result = await handle("get_task", {
      projectId: "demo",
      runId: "run-1",
    });
    assert.equal(result.structuredContent.ok, true);
    if (result.structuredContent.ok) {
      assert.equal(result.structuredContent.data.runId, "run-1");
      assert.equal(
        (result.structuredContent.data.baseline as { afterSeq: number })
          .afterSeq,
        1,
      );
    }
    const bad = await handle("get_task", {
      projectId: "other",
      runId: "run-1",
    });
    assert.equal(bad.structuredContent.ok, false);
    assert.equal(
      fixture.requests.some((r) => r.url.includes("/p/other/")),
      false,
    );
  } finally {
    client.close();
    await fixture.close();
  }
});
test("redirects, invalid wire shape and mismatched task identity fail explicitly", async () => {
  const fixture = await fixtureServer((req, res) => {
    if (req.url?.endsWith("/runs/run-1")) {
      json(res, fixtureRun("wrong"));
      return true;
    }
  });
  const client = new HttpCezarClient({ url: fixture.url });
  try {
    await assert.rejects(
      client.getTask({ projectId: "demo", runId: "run-1" }),
      /identity/,
    );
  } finally {
    client.close();
    await fixture.close();
  }
  const redirect = await fixtureServer((_req, res) => {
    res.writeHead(302, { location: "http://127.0.0.1:1" });
    res.end();
    return true;
  });
  try {
    await assert.rejects(
      new HttpCezarClient({ url: redirect.url }).connection(),
      /unavailable/,
    );
  } finally {
    await redirect.close();
  }
});
