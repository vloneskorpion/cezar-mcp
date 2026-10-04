import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CezarError,
  failure,
  taskRefSchema,
  projectIdSchema,
  toolInputs,
  knownStatusSchema,
} from "../core/contracts.js";
import type { TaskRef, ToolInput, WatchBaseline } from "../core/contracts.js";
import type {
  CezarClient,
  Connection,
  Run,
  JsonRecord,
  WaitResult,
} from "../core/cezar-client.js";
import {
  healthWire,
  projectsWire,
  workflowsWire,
  runWire,
  historyWire,
  historyProjection,
  messageWire,
  continuedWire,
  cancelledWire,
  finishedWire,
  dispatchWire,
} from "./wire.js";
import { discoverEndpoint, validateEndpoint } from "./discovery.js";
import { watchTasks } from "./events.js";
import { parseJson, readBounded, requestScope } from "./transport.js";

const changesWire = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      oldPath: z.string().optional(),
      status: z.enum(["added", "modified", "deleted", "renamed", "copied"]),
      adds: z.number(),
      dels: z.number(),
      binary: z.boolean(),
      image: z.boolean().optional(),
    }),
  ),
  stat: z.object({ adds: z.number(), dels: z.number(), files: z.number() }),
  repointedHead: z
    .object({ branch: z.string().optional(), sha: z.string().optional() })
    .optional(),
});
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const digest = (value: unknown) =>
  value === undefined
    ? null
    : createHash("sha256").update(stable(value)).digest("hex");
export interface HttpClientOptions {
  url?: string;
  fetch?: typeof fetch;
  readTimeoutMs?: number;
  mutationTimeoutMs?: number;
}
export class HttpCezarClient implements CezarClient {
  private target?: string;
  private metadata?: Connection;
  private connecting?: Promise<Connection>;
  private readonly lifetime = new AbortController();
  private readonly request: typeof fetch;
  private projects = new Set<string>();
  constructor(private readonly options: HttpClientOptions = {}) {
    this.target =
      options.url === undefined ? undefined : validateEndpoint(options.url);
    this.request = options.fetch ?? globalThis.fetch;
  }
  close(): void {
    this.lifetime.abort();
  }
  async connection(signal?: AbortSignal): Promise<Connection> {
    if (this.metadata) {
      signal?.throwIfAborted();
      this.lifetime.signal.throwIfAborted();
      return this.metadata;
    }
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      if (!this.target) {
        const discovery = requestScope([signal, this.lifetime.signal]);
        try {
          this.target = await discoverEndpoint({
            fetch: this.request,
            signal: discovery.signal,
          });
        } finally {
          discovery.dispose();
        }
      }
      const health = await this.readAt("/api/v1/health", healthWire, signal);
      this.metadata = {
        targetUrl: this.target,
        cezarVersion: health.version,
        compatibility: "unverified",
        capabilities: health.capabilities,
      };
      return this.metadata;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }
  private async readAt<S extends z.ZodType>(
    path: string,
    schema: S,
    signal?: AbortSignal,
  ): Promise<z.infer<S>> {
    return this.http(path, schema, { signal });
  }
  protected async http<S extends z.ZodType>(
    path: string,
    schema: S,
    options: {
      signal?: AbortSignal;
      method?: string;
      body?: unknown;
      ref?: TaskRef;
      text?: boolean;
    } = {},
  ): Promise<z.infer<S>> {
    const mutation = !!options.method && options.method !== "GET";
    const scope = requestScope(
      [options.signal, this.lifetime.signal],
      mutation
        ? (this.options.mutationTimeoutMs ?? 30_000)
        : (this.options.readTimeoutMs ?? 15_000),
    );
    let sent = false;
    try {
      scope.signal.throwIfAborted();
      sent = true;
      const response = await this.request(`${this.target}${path}`, {
        method: options.method ?? "GET",
        signal: scope.signal,
        redirect: "error",
        ...(options.body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(options.body),
            }),
      });
      const raw = await readBounded(response);
      if (!response.ok) {
        const code =
          (
            {
              400: "invalid_input",
              404: "not_found",
              409: "conflict",
              401: "access_denied",
              403: "access_denied",
            } as Record<number, string>
          )[response.status] ?? "server_error";
        let message = `Cezar refused the request (HTTP ${response.status}).`;
        try {
          const value = JSON.parse(raw);
          if (
            typeof value.error === "string" &&
            !/<\/?(?:html|body|script)\b/i.test(value.error)
          )
            message = value.error.slice(0, 2000);
        } catch {
          /* never expose raw error bodies */
        }
        throw failure(code, message, {
          httpStatus: response.status,
          outcome: mutation && response.status >= 500 ? "unknown" : "rejected",
        });
      }
      const value: unknown = options.text ? raw : parseJson(raw);
      const parsed = schema.safeParse(value);
      if (!parsed.success)
        throw failure(
          "incompatible_server",
          `Cezar returned an unsupported response shape (${parsed.error.issues
            .slice(0, 4)
            .map((issue) => issue.path.join("."))
            .join(", ")}).`,
        );
      if (
        options.ref &&
        Object.is(schema, runWire) &&
        (parsed.data as Run).id !== options.ref.runId
      )
        throw failure(
          "incompatible_server",
          "Task identity does not match the scoped request.",
        );
      return parsed.data;
    } catch (error) {
      if (
        mutation &&
        sent &&
        (!(error instanceof CezarError) || error.detail.outcome !== "rejected")
      ) {
        throw failure(
          "outcome_unknown",
          "The write may have been accepted; it was attempted once and will not be retried.",
          {
            outcome: "unknown",
            ...(options.ref ? { taskRef: options.ref } : {}),
            recovery:
              "Inspect get_task, list_tasks and read_messages before deciding whether another write is needed.",
          },
        );
      }
      if (error instanceof CezarError) throw error;
      throw failure(
        "server_unavailable",
        "The selected cezar cockpit is unavailable or the request was cancelled.",
      );
    } finally {
      scope.abort();
      scope.dispose();
    }
  }
  private async scopeProject(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    projectIdSchema.parse(projectId);
    await this.connection(signal);
    if (!this.projects.has(projectId)) await this.listProjects(signal);
    if (!this.projects.has(projectId))
      throw failure(
        "not_found",
        "Unknown concrete project id. Refresh list_projects.",
      );
    return `/api/v1/p/${encodeURIComponent(projectId)}`;
  }
  protected async taskPath(
    ref: TaskRef,
    signal?: AbortSignal,
  ): Promise<string> {
    taskRefSchema.parse(ref);
    return `${await this.scopeProject(ref.projectId, signal)}/runs/${encodeURIComponent(ref.runId)}`;
  }
  async listProjects(signal?: AbortSignal) {
    await this.connection(signal);
    const value = await this.readAt("/api/v1/projects", projectsWire, signal);
    this.projects = new Set(value.projects.map((p) => p.id));
    return value.projects;
  }
  async listWorkflows(projectId: string, signal?: AbortSignal) {
    return this.readAt(
      `${await this.scopeProject(projectId, signal)}/workflows`,
      workflowsWire,
      signal,
    );
  }
  async listTasks(projectId: string, signal?: AbortSignal) {
    return this.readAt(
      `${await this.scopeProject(projectId, signal)}/runs`,
      z.array(runWire),
      signal,
    );
  }
  async getTask(ref: TaskRef, signal?: AbortSignal): Promise<Run> {
    const run = await this.readAt(
      await this.taskPath(ref, signal),
      runWire,
      signal,
    );
    if (run.id !== ref.runId)
      throw failure(
        "incompatible_server",
        "Task identity does not match the scoped request.",
      );
    return run;
  }
  async readMessages(ref: TaskRef, cursor?: string, signal?: AbortSignal) {
    const path = await this.taskPath(ref, signal);
    return historyProjection(
      await this.readAt(
        `${path}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        historyWire,
        signal,
      ),
    );
  }
  async getChanges(
    ref: TaskRef,
    view: "summary" | "diff",
    signal?: AbortSignal,
  ): Promise<JsonRecord | string> {
    const path = await this.taskPath(ref, signal);
    if (view === "diff")
      return this.http(`${path}/diff`, z.string(), { signal, text: true });
    return this.readAt(`${path}/changes`, changesWire, signal);
  }
  watchState(run: Run): WatchBaseline["state"] {
    return {
      status: run.status.slice(0, 128),
      activity: run.activity?.slice(0, 128) ?? null,
      monitoringWakeAt: run.monitoringWakeAt?.slice(0, 128) ?? null,
      monitoringWakeCapReached: run.monitoringWakeCapReached ?? null,
      stepDigest: digest(
        run.steps.find((step) => step.id === run.currentStepId)
          ? (({ id, name, kind, status, iterations }) => ({
              id,
              name,
              kind,
              status,
              iterations,
            }))(run.steps.find((step) => step.id === run.currentStepId)!)
          : undefined,
      ),
      reportDigest: digest(run.dispatch?.report),
      questionDigest: digest(run.pendingQuestion ?? run.dispatch?.pendingAsk),
    };
  }
  private async mutationPath(
    ref: TaskRef,
    signal?: AbortSignal,
  ): Promise<string> {
    const run = await this.getTask(ref, signal);
    if (!knownStatusSchema.safeParse(run.status).success)
      throw failure(
        "unsupported_task_status",
        "The observed status is unsupported; inspect the task in the cockpit before changing it.",
        { taskRef: ref },
      );
    return this.taskPath(ref, signal);
  }
  async createTask(
    input: ToolInput<"create_task">,
    signal?: AbortSignal,
  ): Promise<Run> {
    const { projectId, ...body } = toolInputs.create_task.parse(input);
    const path = await this.scopeProject(projectId, signal);
    if (
      body.dispatch !== undefined &&
      !(await this.connection(signal)).capabilities.dispatch
    )
      throw failure(
        "dispatch_disabled",
        "Dispatch is disabled; task creation was not attempted.",
      );
    return this.http(`${path}/runs`, runWire, {
      method: "POST",
      body: { ...body, variants: 1, worktree: true },
      signal,
    });
  }
  async updateTask(
    ref: TaskRef,
    patch: ToolInput<"update_task">["patch"],
    signal?: AbortSignal,
  ): Promise<Run> {
    const input = toolInputs.update_task.parse({ ...ref, patch });
    return this.http(await this.mutationPath(ref, signal), runWire, {
      method: "PATCH",
      body: input.patch,
      ref,
      signal,
    });
  }
  async sendMessage(ref: TaskRef, text: string, signal?: AbortSignal) {
    const input = toolInputs.send_message.parse({ ...ref, text });
    return this.http(
      `${await this.mutationPath(ref, signal)}/messages`,
      messageWire,
      { method: "POST", body: { text: input.text }, ref, signal },
    );
  }
  async continueTask(
    ref: TaskRef,
    input: Omit<ToolInput<"continue_task">, keyof TaskRef>,
    signal?: AbortSignal,
  ) {
    const {
      projectId: _project,
      runId: _run,
      ...body
    } = toolInputs.continue_task.parse({ ...ref, ...input });
    return this.http(
      `${await this.mutationPath(ref, signal)}/continue`,
      continuedWire,
      { method: "POST", body, ref, signal },
    );
  }
  async cancelTask(ref: TaskRef, signal?: AbortSignal) {
    return this.http(
      `${await this.mutationPath(ref, signal)}/cancel`,
      cancelledWire,
      { method: "POST", ref, signal },
    );
  }
  async finishTask(ref: TaskRef, signal?: AbortSignal) {
    return this.http(
      `${await this.mutationPath(ref, signal)}/finish`,
      finishedWire,
      { method: "POST", ref, signal },
    );
  }
  async dispatchTask(
    ref: TaskRef,
    order: ToolInput<"dispatch_task">["order"],
    signal?: AbortSignal,
  ) {
    const input = toolInputs.dispatch_task.parse({ ...ref, order });
    return this.http(
      `${await this.mutationPath(ref, signal)}/dispatch`,
      dispatchWire,
      { method: "POST", body: input.order, ref, signal },
    );
  }
  async waitForEvents(
    watches: WatchBaseline[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<WaitResult> {
    const input = toolInputs.wait_for_events.parse({ watches, timeoutMs });
    return watchTasks(this, input.watches, input.timeoutMs, {
      signal,
      lifetime: this.lifetime.signal,
      open: async (baseline, signal) => {
        const path = await this.taskPath(
          { projectId: baseline.projectId, runId: baseline.runId },
          signal,
        );
        const response = await this.request(
          `${this.target}${path}/events?afterSeq=${baseline.afterSeq}`,
          {
            signal,
            redirect: "error",
            headers: { accept: "text/event-stream" },
          },
        );
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw failure(
            response.status === 404 ? "not_found" : "resync_required",
            `The task stream was refused (HTTP ${response.status}).`,
            { httpStatus: response.status },
          );
        }
        if (
          !response.headers.get("content-type")?.startsWith("text/event-stream")
        ) {
          await response.body?.cancel().catch(() => {});
          throw failure(
            "incompatible_server",
            "The task stream had an unsupported content type.",
          );
        }
        return response;
      },
    });
  }
}
