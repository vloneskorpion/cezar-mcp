/** Minimum consumed wire fields; provenance: cezar 1f40016d, packages/contract/src and server.ts. */
import { z } from "zod";
import { runIdSchema, seqSchema } from "../core/contracts.js";
import type { HistoryPage } from "../core/cezar-client.js";

const string = z.string();
const number = z.number().finite();
export const healthWire = z.object({
  version: string.min(1),
  repoRoot: string,
  bootProject: string,
  capabilities: z.object({
    dispatch: z.boolean(),
    tokenMetrics: z.boolean(),
    tokenUsageMetrics: z.boolean(),
    costMetrics: z.boolean(),
  }),
});
export const projectWire = z.object({
  id: string
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .refine((v) => v !== "default"),
  name: string,
  status: z.enum(["ok", "missing", "not-git"]),
  unregistered: z.literal(true).optional(),
});
export const projectsWire = z.object({
  projects: z.array(projectWire),
  bootProject: string,
});
export const workflowsWire = z.object({
  workflows: z.array(
    z.object({ name: string, description: string.optional() }),
  ),
  issues: z.array(z.object({ path: string, message: string })),
});
export const stepWire = z.object({
  id: string,
  name: string,
  kind: string,
  status: string,
  iterations: number.optional(),
  tokensUsed: number.optional(),
  costUsd: number.optional(),
  inputTokens: number.optional(),
  outputTokens: number.optional(),
});
const reportWire = z.object({
  status: z.enum(["done", "partial", "failed", "blocked"]),
  result: string.max(4000),
  evidence: z.array(string.max(400)).max(12),
  confidence: number.min(0).max(1).optional(),
  side_effects: z.array(string.max(400)).max(12),
  errors: z.array(string.max(400)).max(12),
  recommended_next_action: string.max(1000).optional(),
  verdict: z.enum(["approve", "changes", "reject"]).optional(),
  suggestions: z.array(string.max(400)).max(8),
});
export const runWire = z.object({
  id: runIdSchema,
  title: string,
  status: string.min(1),
  createdAt: string,
  task: string,
  steps: z.array(stepWire),
  currentStepId: string.optional(),
  titleSummary: string.optional(),
  activity: string.optional(),
  monitoringWakeAt: string.optional(),
  monitoringWakeCapReached: z.boolean().optional(),
  workflow: string.optional(),
  runner: string.optional(),
  model: string.optional(),
  branch: string.optional(),
  startedAt: string.optional(),
  finishedAt: string.optional(),
  tokensUsed: number.optional(),
  inputTokens: number.optional(),
  outputTokens: number.optional(),
  costUsd: number.optional(),
  diffStat: z
    .object({
      adds: number,
      dels: number,
      files: number,
      repointed: z.boolean().optional(),
    })
    .optional(),
  queuedMessages: z
    .array(z.object({ id: string, createdAt: string }))
    .optional(),
  dispatch: z
    .object({
      rootRunId: string,
      parentRunId: string.optional(),
      kind: string.optional(),
      budgetUsd: number.optional(),
      overBudget: z.boolean().optional(),
      report: reportWire.optional(),
      pendingAsk: z
        .object({
          requestId: string.optional(),
          questions: z.array(string.max(400)).max(4),
          askedAt: string,
        })
        .optional(),
    })
    .optional(),
});
export const messageWire = z.union([
  z.object({
    delivered: z.literal(true),
    queued: z.never().optional(),
    deferred: z.never().optional(),
  }),
  z.object({
    queued: z.literal(true),
    message: z.object({ id: string, createdAt: string }),
    delivered: z.never().optional(),
    deferred: z.never().optional(),
  }),
  z.object({
    deferred: z.literal(true),
    delivered: z.never().optional(),
    queued: z.never().optional(),
  }),
]);
export const eventWire = z
  .object({
    seq: seqSchema,
    ts: string.max(128),
    type: string.min(1).max(128),
    stepId: string.max(128).optional(),
  })
  .catchall(z.unknown());
export const historyWire = z.object({
  events: z.array(eventWire),
  itemCount: z.number().int().min(0).max(100),
  liveCursor: string.min(1).max(2048),
  asOfSeq: seqSchema,
  hasOlder: z.boolean(),
  olderCursor: string.min(1).max(2048).optional(),
  newerCursor: string.min(1).max(2048).optional(),
});
export function historyProjection(
  page: z.infer<typeof historyWire>,
): HistoryPage {
  return {
    ...page,
    events: page.events.map(({ seq, ts, type, stepId, ...payload }) => ({
      seq,
      ts,
      type,
      ...(stepId === undefined ? {} : { stepId }),
      payload,
    })),
  };
}
export const continuedWire = z.object({ continued: z.literal(true) });
export const cancelledWire = z.object({ cancelled: z.boolean() });
export const finishedWire = z.object({ finished: z.literal(true) });
export const dispatchWire = z.object({
  id: runIdSchema,
  branch: string.optional(),
});
