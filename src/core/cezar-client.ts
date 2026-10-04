import type { TaskRef, ToolInput, WatchBaseline } from './contracts.js';

export type JsonRecord = Record<string, unknown>;
export interface Capabilities { dispatch: boolean; tokenMetrics: boolean; tokenUsageMetrics: boolean; costMetrics: boolean }
export interface Connection { targetUrl: string; cezarVersion: string; compatibility: 'verified' | 'unverified'; capabilities: Capabilities }
export interface Project { id: string; name: string; status: string; unregistered?: true }
export interface Step { id: string; name: string; kind: string; status: string; iterations?: number; tokensUsed?: number; costUsd?: number; inputTokens?: number; outputTokens?: number }
export interface Run {
  id: string; title: string; status: string; createdAt: string; task: string; steps: Step[]; currentStep: number;
  titleSummary?: string; activity?: string; monitoringWakeAt?: string; monitoringWakeCapReached?: boolean;
  workflow?: string; runner?: string; model?: string; branch?: string; startedAt?: string; finishedAt?: string;
  tokensUsed?: number; inputTokens?: number; outputTokens?: number; costUsd?: number;
  diffStat?: { adds: number; dels: number; files: number; repointed?: boolean };
  queuedMessages?: { id: string; createdAt: string }[];
  dispatch?: { rootRunId: string; parentRunId?: string; kind?: string; budgetUsd?: number; overBudget?: boolean; report?: JsonRecord; pendingAsk?: JsonRecord };
}
export interface HistoryEvent { seq: number; ts: string; type: string; stepId?: string; payload: JsonRecord }
export interface HistoryPage { events: HistoryEvent[]; itemCount: number; liveCursor: string; asOfSeq: number; hasOlder: boolean; olderCursor?: string; newerCursor?: string }
export type MessageAcceptance = { delivered: true } | { queued: true; message: { id: string; createdAt: string } } | { deferred: true };
export interface WaitObservation { taskRef: TaskRef; baseline?: WatchBaseline; task?: Run; kinds: ('state_changed' | 'transcript_available')[]; error?: import('./contracts.js').ToolError }
export interface WaitResult { timedOut: boolean; observations: WaitObservation[] }
/** Transport-neutral operations. Each operation owns and respects its abort signal. */
export interface CezarClient {
  connection(signal?: AbortSignal): Promise<Connection>;
  listProjects(signal?: AbortSignal): Promise<Project[]>;
  listWorkflows(projectId: string, signal?: AbortSignal): Promise<{ workflows: { name: string; description?: string }[]; issues: { path: string; message: string }[] }>;
  listTasks(projectId: string, signal?: AbortSignal): Promise<Run[]>;
  getTask(ref: TaskRef, signal?: AbortSignal): Promise<Run>;
  readMessages(ref: TaskRef, cursor?: string, signal?: AbortSignal): Promise<HistoryPage>;
  getChanges(ref: TaskRef, view: 'summary' | 'diff', signal?: AbortSignal): Promise<JsonRecord | string>;
  watchState(run: Run): WatchBaseline['state'];
  createTask(input: ToolInput<'create_task'>, signal?: AbortSignal): Promise<Run>;
  updateTask(ref: TaskRef, patch: ToolInput<'update_task'>['patch'], signal?: AbortSignal): Promise<Run>;
  sendMessage(ref: TaskRef, text: string, signal?: AbortSignal): Promise<MessageAcceptance>;
  continueTask(ref: TaskRef, input: Omit<ToolInput<'continue_task'>, keyof TaskRef>, signal?: AbortSignal): Promise<{ continued: true }>;
  cancelTask(ref: TaskRef, signal?: AbortSignal): Promise<{ cancelled: boolean }>;
  finishTask(ref: TaskRef, signal?: AbortSignal): Promise<{ finished: true }>;
  dispatchTask(ref: TaskRef, order: ToolInput<'dispatch_task'>['order'], signal?: AbortSignal): Promise<{ id: string; branch?: string }>;
  waitForEvents(watches: WatchBaseline[], timeoutMs: number, signal?: AbortSignal): Promise<WaitResult>;
  close(): void;
}
