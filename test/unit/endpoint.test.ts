import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEndpoint,
  discoverEndpoint,
} from "../../src/cezar/discovery.js";
import { parseArguments } from "../../src/cli.js";
import { fixtureHealth } from "../fixtures/server.js";
test("only literal loopback HTTP origins are permitted", () => {
  for (const v of [
    "http://127.0.0.1:4321",
    "http://127.5.4.3:4321/",
    "http://[::1]:4321",
  ])
    assert.ok(validateEndpoint(v));
  for (const v of [
    "https://127.0.0.1",
    "http://localhost",
    "http://127.0.0.1/a",
    "http://127.0.0.1?x=1",
    "http://user:pass@127.0.0.1",
    "http://10.0.0.1",
    "http://2130706433",
    "http://127.0.0.1/../",
    "http://127.0.0.1#",
  ])
    assert.throws(() => validateEndpoint(v));
  assert.equal(
    parseArguments(["--url", "http://127.0.0.1:5555"], {
      CEZAR_MCP_URL: "http://127.0.0.1:4321",
      CEZ_API_URL: "http://127.0.0.1:9000",
    }).url,
    "http://127.0.0.1:5555",
  );
  assert.equal(
    parseArguments([], { CEZ_API_URL: "http://127.0.0.1:9000" }).url,
    undefined,
  );
});
test("discovery scans all fifty ports with at most five concurrent probes", async () => {
  let active = 0,
    max = 0,
    calls = 0;
  const request: typeof fetch = async (url) => {
    active++;
    calls++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 1));
    active--;
    if (String(url).includes(":4325/")) return Response.json(fixtureHealth);
    throw new Error("connection refused");
  };
  assert.equal(
    await discoverEndpoint({ fetch: request }),
    "http://127.0.0.1:4325",
  );
  assert.equal(calls, 50);
  assert.equal(max, 5);
});
test("discovery refuses ambiguous and incomplete scans", async () => {
  await assert.rejects(
    discoverEndpoint({ fetch: async () => Response.json(fixtureHealth) }),
    /Multiple cockpits/,
  );
  const request: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    });
  await assert.rejects(
    discoverEndpoint({ fetch: request, deadlineMs: 15, probeMs: 100 }),
    /did not complete/,
  );
});
