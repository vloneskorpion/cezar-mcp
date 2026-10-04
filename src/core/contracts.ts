import { z } from 'zod';

export const projectIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).refine(v => v !== 'default', 'Use a concrete project id from list_projects');
export const runIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/).refine(v => v !== '.' && v !== '..');
export const runnerSchema = z.enum(['claude', 'codex', 'opencode', 'cursor', 'pi', 'junie', 'copilot']);
export const knownStatusSchema = z.enum(['queued', 'running', 'waiting', 'review', 'done', 'failed', 'cancelled']);
export const seqSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const model = z.string().min(1).max(200).refine(v => !!v.trim());
const text = z.string().min(1).max(100_000).refine(v => !!v.trim());
const limit = z.number().int().min(1).max(100);
const offset = z.number().int().min(0).max(1_000_000);
export const taskRefSchema = z.strictObject({ projectId: projectIdSchema, runId: runIdSchema });
export type TaskRef = z.infer<typeof taskRefSchema>;
export const watchStateSchema = z.strictObject({
  status: z.string().max(128), activity: z.string().max(128).nullable(),
  monitoringWakeAt: z.string().max(128).nullable(), monitoringWakeCapReached: z.boolean().nullable(),
  stepDigest: z.string().length(64).nullable(), reportDigest: z.string().length(64).nullable(), questionDigest: z.string().length(64).nullable(),
});
export const baselineSchema = taskRefSchema.extend({ afterSeq: seqSchema, state: watchStateSchema });
export type WatchBaseline = z.infer<typeof baselineSchema>;
export const dispatchIntentSchema = z.strictObject({
  maxSubtasks: z.number().int().min(1).max(50).optional(), inFlight: z.number().int().min(1).max(4).optional(),
  runner: runnerSchema.optional(), model: model.max(120).optional(), budgetUsd: z.number().positive().max(10_000).optional(),
});
export const dispatchOrderSchema = z.strictObject({
  title: z.string().min(1).max(120).optional(), objective: z.string().min(1).max(4000),
  kind: z.enum(['implement', 'review']).optional(), review_of: z.array(z.string().max(120)).max(8).optional(),
  scope: z.string().max(1000).optional(), allowed_tools: z.array(z.string().max(80)).max(16).optional(),
  max_cost: z.number().positive().optional(), success_criteria: z.string().max(1000).optional(),
  required_evidence: z.string().max(1000).optional(), retry_limit: z.number().int().min(0).max(3).optional(),
  runner: runnerSchema.optional(), model: model.optional(),
});
export const toolInputs = {
  list_projects: z.strictObject({ limit: limit.default(50), offset: offset.default(0) }),
  list_workflows: z.strictObject({ projectId: projectIdSchema }),
  list_tasks: z.strictObject({ projectId: projectIdSchema, statuses: z.array(knownStatusSchema).min(1).max(7).optional(), query: z.string().max(1000).optional(), limit: limit.default(20), offset: offset.default(0) }),
  get_task: taskRefSchema,
  read_messages: taskRefSchema.extend({ cursor: z.string().min(1).max(2048).optional() }),
  get_changes: taskRefSchema.extend({ view: z.enum(['summary', 'diff']).default('summary') }),
  create_task: z.strictObject({ projectId: projectIdSchema, task: text, workflow: z.string().min(1).max(200).default('quick-task'), runner: runnerSchema.optional(), model: model.optional(), autonomous: z.boolean().optional(), dispatch: dispatchIntentSchema.optional() }),
  update_task: taskRefSchema.extend({ patch: z.strictObject({ title: z.string().trim().min(1).max(300).optional(), task: z.string().trim().min(1).max(100_000).optional() }).refine(p => p.title !== undefined || p.task !== undefined, 'Patch must not be empty') }),
  send_message: taskRefSchema.extend({ text }),
  continue_task: taskRefSchema.extend({ text: z.string().max(100_000).optional(), runner: runnerSchema.optional(), model: model.optional() }),
  cancel_task: taskRefSchema,
  finish_task: taskRefSchema,
  dispatch_task: taskRefSchema.extend({ order: dispatchOrderSchema }),
  wait_for_events: z.strictObject({ watches: z.array(baselineSchema).min(1).max(16).refine(w => new Set(w.map(x => `${x.projectId}/${x.runId}`)).size === w.length, 'Duplicate watch'), timeoutMs: z.number().int().min(0).max(30_000).default(25_000) }),
};
export type ToolName = keyof typeof toolInputs;
export type ToolInput<N extends ToolName> = z.infer<(typeof toolInputs)[N]>;
export const mutationTools = new Set<ToolName>(['create_task', 'update_task', 'send_message', 'continue_task', 'cancel_task', 'finish_task', 'dispatch_task']);
export const errorSchema = z.strictObject({
  code: z.string(), message: z.string(), httpStatus: z.number().int().optional(),
  outcome: z.enum(['not_attempted', 'rejected', 'unknown']), recovery: z.string().optional(), taskRef: taskRefSchema.optional(),
});
export type ToolError = z.infer<typeof errorSchema>;
export const resultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data: z.record(z.string(), z.unknown()), truncated: z.boolean() }),
  z.strictObject({ ok: z.literal(false), error: errorSchema }),
]);
export type ResultEnvelope = z.infer<typeof resultSchema>;
export class CezarError extends Error {
  constructor(public readonly detail: ToolError) { super(detail.message); this.name = 'CezarError'; }
}
export function failure(code: string, message: string, extra: Partial<ToolError> = {}): CezarError {
  return new CezarError({ code, message, outcome: 'not_attempted', ...extra });
}
