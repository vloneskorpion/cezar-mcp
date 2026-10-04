import { test } from "node:test";
import assert from "node:assert/strict";
import { toolInputs } from "../../src/core/contracts.js";
import { runWire, messageWire } from "../../src/cezar/wire.js";
const ref = { projectId: "demo", runId: "run-1" };
test("strict scope, limits and patches are checked before execution", () => {
  for (const input of [
    { ...ref, typo: true },
    { ...ref, projectId: "default" },
    { ...ref, runId: ".." },
  ])
    assert.equal(toolInputs.get_task.safeParse(input).success, false);
  assert.equal(
    toolInputs.update_task.safeParse({ ...ref, patch: {} }).success,
    false,
  );
  assert.equal(
    toolInputs.continue_task.safeParse({ ...ref, text: "x".repeat(100001) })
      .success,
    false,
  );
  assert.equal(
    toolInputs.create_task.parse({
      projectId: "demo",
      task: "/skill\nExact text",
    }).task,
    "/skill\nExact text",
  );
  assert.equal(toolInputs.list_projects.parse({}).limit, 50);
});
test("wire adds are stripped; unknown status and optional costs remain honest", () => {
  const run = runWire.parse({
    id: "run-1",
    title: "task",
    status: "future-status",
    createdAt: "now",
    task: "text",
    steps: [],
    currentStepId: "s1",
    secret: "no",
  });
  assert.equal(run.status, "future-status");
  assert.equal("costUsd" in run, false);
  assert.equal("secret" in run, false);
});
test("the message acceptance union permits exactly one acceptance outcome", () => {
  for (const value of [
    { delivered: true },
    { queued: true, message: { id: "m", createdAt: "now" } },
    { deferred: true },
  ])
    assert.equal(messageWire.safeParse(value).success, true);
  for (const value of [
    {},
    { delivered: true, deferred: true },
    { queued: true },
  ])
    assert.equal(messageWire.safeParse(value).success, false);
});
