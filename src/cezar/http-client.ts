import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CezarError, failure, taskRefSchema, projectIdSchema } from '../core/contracts.js';
import type { TaskRef, ToolInput, WatchBaseline } from '../core/contracts.js';
import type { CezarClient, Connection, Run, JsonRecord, WaitResult } from '../core/cezar-client.js';
import { healthWire, projectsWire, workflowsWire, runWire, historyWire, historyProjection } from './wire.js';
import { discoverEndpoint, validateEndpoint } from './discovery.js';
import { parseJson, readBounded, requestScope } from './transport.js';

const changesWire = z.object({
  files: z.array(z.object({ path: z.string(), oldPath: z.string().optional(), status: z.enum(['added','modified','deleted','renamed','copied']), adds: z.number(), dels: z.number(), binary: z.boolean(), image: z.boolean().optional() })),
  stat: z.object({ adds: z.number(), dels: z.number(), files: z.number() }),
  repointedHead: z.object({ branch: z.string().optional(), sha: z.string().optional() }).optional(),
});
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const digest = (value: unknown) => value === undefined ? null : createHash('sha256').update(stable(value)).digest('hex');
export interface HttpClientOptions { url?: string; fetch?: typeof fetch; readTimeoutMs?: number; mutationTimeoutMs?: number }
export class HttpCezarClient implements CezarClient {
  private target?: string;
  private metadata?: Connection;
  private connecting?: Promise<Connection>;
  private readonly lifetime = new AbortController();
  private readonly request: typeof fetch;
  private projects = new Set<string>();
  constructor(private readonly options: HttpClientOptions = {}) {
    this.target = options.url === undefined ? undefined : validateEndpoint(options.url);
    this.request = options.fetch ?? globalThis.fetch;
  }
  close(): void { this.lifetime.abort(); }
  async connection(signal?: AbortSignal): Promise<Connection> {
    if (this.metadata) { signal?.throwIfAborted(); this.lifetime.signal.throwIfAborted(); return this.metadata; }
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      if (!this.target) this.target = await discoverEndpoint({ fetch: this.request, signal });
      const health = await this.readAt('/api/v1/health', healthWire, signal);
      this.metadata = { targetUrl: this.target, cezarVersion: health.version, compatibility: 'unverified', capabilities: health.capabilities };
      return this.metadata;
    })();
    try { return await this.connecting; } finally { this.connecting = undefined; }
  }
  private async readAt<S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
    return this.http(path, schema, { signal });
  }
  protected async http<S extends z.ZodType>(path: string, schema: S, options: { signal?: AbortSignal; method?: string; body?: unknown; ref?: TaskRef; text?: boolean } = {}): Promise<z.infer<S>> {
    const mutation = !!options.method && options.method !== 'GET';
    const scope = requestScope([options.signal, this.lifetime.signal], mutation ? this.options.mutationTimeoutMs ?? 30_000 : this.options.readTimeoutMs ?? 15_000);
    let sent = false;
    try {
      scope.signal.throwIfAborted();
      sent = true;
      const response = await this.request(`${this.target}${path}`, {
        method: options.method ?? 'GET', signal: scope.signal, redirect: 'error',
        ...(options.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) }),
      });
      const raw = await readBounded(response);
      if (!response.ok) {
        const code = ({ 400: 'invalid_input', 404: 'not_found', 409: 'conflict', 401: 'access_denied', 403: 'access_denied' } as Record<number,string>)[response.status] ?? 'server_error';
        let message = `Cezar refused the request (HTTP ${response.status}).`;
        try { const value = JSON.parse(raw); if (typeof value.error === 'string' && !/<\/?(?:html|body|script)\b/i.test(value.error)) message = value.error.slice(0, 2000); } catch { /* never expose raw error bodies */ }
        throw failure(code, message, { httpStatus: response.status, outcome: mutation && response.status >= 500 ? 'unknown' : 'rejected' });
      }
      const value: unknown = options.text ? raw : parseJson(raw);
      const parsed = schema.safeParse(value);
      if (!parsed.success) throw failure('incompatible_server', 'Cezar returned an unsupported response shape.');
      return parsed.data;
    } catch (error) {
      if (mutation && sent && (!(error instanceof CezarError) || error.detail.outcome !== 'rejected')) {
        throw failure('outcome_unknown', 'The write may have been accepted; it was attempted once and will not be retried.', { outcome: 'unknown', ...(options.ref ? { taskRef: options.ref } : {}), recovery: 'Inspect get_task, list_tasks and read_messages before deciding whether another write is needed.' });
      }
      if (error instanceof CezarError) throw error;
      throw failure('server_unavailable', 'The selected cezar cockpit is unavailable or the request was cancelled.');
    } finally { scope.abort(); scope.dispose(); }
  }
  private async scopeProject(projectId: string, signal?: AbortSignal): Promise<string> {
    projectIdSchema.parse(projectId);
    await this.connection(signal);
    if (!this.projects.has(projectId)) await this.listProjects(signal);
    if (!this.projects.has(projectId)) throw failure('not_found', 'Unknown concrete project id. Refresh list_projects.');
    return `/api/v1/p/${encodeURIComponent(projectId)}`;
  }
  protected async taskPath(ref: TaskRef, signal?: AbortSignal): Promise<string> {
    taskRefSchema.parse(ref);
    return `${await this.scopeProject(ref.projectId, signal)}/runs/${encodeURIComponent(ref.runId)}`;
  }
  async listProjects(signal?: AbortSignal) {
    await this.connection(signal);
    const value = await this.readAt('/api/v1/projects', projectsWire, signal);
    this.projects = new Set(value.projects.map(p => p.id));
    return value.projects;
  }
  async listWorkflows(projectId: string, signal?: AbortSignal) { return this.readAt(`${await this.scopeProject(projectId, signal)}/workflows`, workflowsWire, signal); }
  async listTasks(projectId: string, signal?: AbortSignal) { return this.readAt(`${await this.scopeProject(projectId, signal)}/runs`, z.array(runWire), signal); }
  async getTask(ref: TaskRef, signal?: AbortSignal): Promise<Run> {
    const run = await this.readAt(await this.taskPath(ref, signal), runWire, signal);
    if (run.id !== ref.runId) throw failure('incompatible_server', 'Task identity does not match the scoped request.');
    return run;
  }
  async readMessages(ref: TaskRef, cursor?: string, signal?: AbortSignal) {
    const path = await this.taskPath(ref, signal);
    return historyProjection(await this.readAt(`${path}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, historyWire, signal));
  }
  async getChanges(ref: TaskRef, view: 'summary' | 'diff', signal?: AbortSignal): Promise<JsonRecord | string> {
    const path = await this.taskPath(ref, signal);
    if (view === 'diff') return this.http(`${path}/diff`, z.string(), { signal, text: true });
    return this.readAt(`${path}/changes`, changesWire, signal);
  }
  watchState(run: Run): WatchBaseline['state'] {
    return { status: run.status.slice(0,128), activity: run.activity?.slice(0,128) ?? null, monitoringWakeAt: run.monitoringWakeAt?.slice(0,128) ?? null, monitoringWakeCapReached: run.monitoringWakeCapReached ?? null, stepDigest: digest(run.steps[run.currentStep]), reportDigest: digest(run.dispatch?.report), questionDigest: digest(run.dispatch?.pendingAsk) };
  }
  async createTask(_input: ToolInput<'create_task'>, _signal?: AbortSignal): Promise<Run> { throw failure('not_implemented', 'Task control is not implemented.'); }
  async updateTask(_ref: TaskRef, _patch: ToolInput<'update_task'>['patch'], _signal?: AbortSignal): Promise<Run> { throw failure('not_implemented', 'Task control is not implemented.'); }
  async sendMessage(_ref: TaskRef, _text: string, _signal?: AbortSignal): Promise<import('../core/cezar-client.js').MessageAcceptance> { throw failure('not_implemented', 'Task control is not implemented.'); }
  async continueTask(_ref: TaskRef, _input: Omit<ToolInput<'continue_task'>, keyof TaskRef>, _signal?: AbortSignal): Promise<{continued:true}> { throw failure('not_implemented', 'Task control is not implemented.'); }
  async cancelTask(_ref: TaskRef, _signal?: AbortSignal): Promise<{cancelled:boolean}> { throw failure('not_implemented', 'Task control is not implemented.'); }
  async finishTask(_ref: TaskRef, _signal?: AbortSignal): Promise<{finished:true}> { throw failure('not_implemented', 'Task control is not implemented.'); }
  async dispatchTask(_ref: TaskRef, _order: ToolInput<'dispatch_task'>['order'], _signal?: AbortSignal): Promise<{id:string;branch?:string}> { throw failure('not_implemented', 'Task control is not implemented.'); }
  async waitForEvents(_watches: WatchBaseline[], _timeoutMs: number, _signal?: AbortSignal): Promise<WaitResult> { throw failure('not_implemented', 'Event waiting is not implemented.'); }
}
