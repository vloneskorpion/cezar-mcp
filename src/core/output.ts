import { CezarError, failure } from './contracts.js';
import type { ResultEnvelope, TaskRef } from './contracts.js';
import type { Capabilities, HistoryEvent, JsonRecord, Run } from './cezar-client.js';

export const OUTPUT_BYTES = 64 * 1024;
const RESULT_BUDGET = 60 * 1024; // Reserve protocol framing/SDK metadata without duplicating the payload in text.
const encoder = new TextEncoder();
export const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
export function clipText(value: string, max = 8192): string {
  if (encoder.encode(value).length <= max) return value;
  let out = ''; let bytes = 0;
  for (const character of value) { const n = encoder.encode(character).length; if (bytes + n > max) break; out += character; bytes += n; }
  return out;
}
function bounded(value: unknown, max: number, mark: () => void, depth = 0): unknown {
  if (typeof value === 'string') { const text = clipText(value, max); if (text !== value) mark(); return text; }
  if (depth > 24) { mark(); return { omitted: true, reason: 'output_limit' }; }
  if (Array.isArray(value)) return value.map(v => bounded(v, max, mark, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k, bounded(v, max, mark, depth + 1)]));
  return value;
}
export function success(data: JsonRecord, summary: string) {
  let truncated = false;
  let projected = bounded(data, 8192, () => { truncated = true; }) as JsonRecord;
  const result = () => ({ content: [{ type: 'text' as const, text: summary }], structuredContent: { ok: true as const, data: projected, truncated } });
  // Collections maintain an offset pointing to the first row removed for bytes.
  const pageKey = ['projects', 'tasks', 'files', 'workflows'].find(k => Array.isArray(projected[k]));
  if (pageKey) {
    const rows = projected[pageKey] as unknown[];
    while (rows.length && jsonBytes(result()) > RESULT_BUDGET) {
      rows.pop(); truncated = true;
      projected.hasMore = true;
      projected.nextOffset = (typeof data.offset === 'number' ? data.offset : 0) + rows.length;
    }
  }
  // History identities/cursors always survive; only payload detail is omitted.
  if (Array.isArray(projected.events) && jsonBytes(result()) > RESULT_BUDGET) {
    for (const item of [...projected.events].reverse() as JsonRecord[]) {
      item.payload = { omitted: true, reason: 'output_limit' }; truncated = true;
      if (jsonBytes(result()) <= RESULT_BUDGET) break;
    }
  }
  for (const max of [2048, 512, 128]) {
    if (jsonBytes(result()) <= RESULT_BUDGET) break;
    // Do not shrink opaque cursors, baselines or identity fields. Shrink display detail only.
    for (const key of ['task', 'diff', 'issues', 'steps', 'queuedMessages', 'dispatchReport', 'pendingQuestion']) {
      if (projected[key] !== undefined) projected[key] = bounded(projected[key], max, () => { truncated = true; });
    }
  }
  if (jsonBytes(result()) > RESULT_BUDGET) throw failure('response_too_large', 'The projected result cannot fit without losing its identity or navigation metadata.');
  return result();
}
export function errorResult(error: unknown) {
  const detail = error instanceof CezarError ? error.detail : failure('internal_error', 'The adapter could not complete the tool call.').detail;
  const envelope: ResultEnvelope = { ok: false, error: { ...detail, message: clipText(detail.message, 2048), ...(detail.recovery ? { recovery: clipText(detail.recovery,2048) } : {}) } };
  return { isError: true, content: [{ type: 'text' as const, text: `${envelope.error.code}: ${envelope.error.message}` }], structuredContent: envelope };
}
export function taskSummary(run: Run, ref: TaskRef, connection: { targetUrl: string; capabilities: Capabilities }): JsonRecord {
  const result: JsonRecord = { ...ref, title: run.titleSummary ?? run.title, status: run.status, statusKnown: ['queued','running','waiting','review','done','failed','cancelled'].includes(run.status), createdAt: run.createdAt, cockpitUrl: `${connection.targetUrl}/p/${encodeURIComponent(ref.projectId)}/runs/${encodeURIComponent(ref.runId)}` };
  for (const key of ['activity','monitoringWakeAt','monitoringWakeCapReached','runner','model','workflow','branch','startedAt','finishedAt','diffStat'] as const) if (run[key] !== undefined) result[key] = run[key];
  if (connection.capabilities.tokenMetrics && connection.capabilities.tokenUsageMetrics) for (const key of ['tokensUsed','inputTokens','outputTokens'] as const) if (run[key] !== undefined) result[key] = run[key];
  if (connection.capabilities.tokenMetrics && connection.capabilities.costMetrics && run.costUsd !== undefined) result.costUsd = run.costUsd;
  if (run.dispatch) result.dispatch = { rootRunId: run.dispatch.rootRunId, ...(run.dispatch.parentRunId ? { parentRunId: run.dispatch.parentRunId } : {}), ...(run.dispatch.kind ? { kind: run.dispatch.kind } : {}), ...(connection.capabilities.tokenMetrics && connection.capabilities.costMetrics && run.dispatch.budgetUsd !== undefined ? { budgetUsd: run.dispatch.budgetUsd } : {}) };
  return result;
}
const metricKey = /token|usage|cost|budget|price|billing|usd|cpu|rss/i;
const knownEvent = /^(?:user|assistant|text|tool|tool_result|result|error|step-start|step-end|run-start|run-end|status|system|message|item\.(?:started|updated|completed)|turn\.(?:started|completed|failed)|session\.(?:started|ended))$/;
function safePayload(value: unknown, caps: Capabilities, depth = 0): unknown {
  if (depth > 24) return { omitted: true, reason: 'output_limit' };
  if (Array.isArray(value)) return value.map(v => safePayload(v,caps,depth+1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !metricKey.test(k) || (caps.tokenMetrics && (/(?:cost|budget|usd|price|billing)/i.test(k) ? caps.costMetrics : caps.tokenUsageMetrics))).map(([k,v]) => [k,safePayload(v,caps,depth+1)]));
  return value;
}
export function historyEvent(event: HistoryEvent, caps: Capabilities): JsonRecord {
  // Unknown event schemas cannot establish whether nested detail is safe under hidden metrics.
  const restricted = !caps.tokenMetrics || !caps.tokenUsageMetrics || !caps.costMetrics;
  return { seq: event.seq, ts: event.ts, type: event.type, ...(event.stepId === undefined ? {} : { stepId: event.stepId }), payload: restricted && !knownEvent.test(event.type) ? { omitted: true, reason: 'metric_visibility' } : safePayload(event.payload,caps) };
}
export function stepProjection(run: Run, caps: Capabilities) { return run.steps.map(step => safePayload(step,caps)); }
