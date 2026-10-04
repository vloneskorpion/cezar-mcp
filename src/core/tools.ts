import {
  toolInputs,
  mutationTools,
  failure,
  knownStatusSchema,
} from "./contracts.js";
import type { ToolName } from "./contracts.js";
import type { CezarClient, JsonRecord } from "./cezar-client.js";
import { pendingQuestion } from "./questions.js";
import {
  success,
  errorResult,
  taskSummary,
  historyEvent,
  stepProjection,
} from "./output.js";

export function createToolHandlers(client: CezarClient, readOnly = false) {
  let waiting = false;
  return async (name: ToolName, raw: unknown, signal?: AbortSignal) => {
    try {
      if (readOnly && mutationTools.has(name))
        throw failure(
          "read_only",
          "This adapter was launched in read-only mode.",
        );
      const parsed = toolInputs[name].safeParse(raw);
      if (!parsed.success)
        throw failure("invalid_input", "The tool arguments failed validation.");
      const input = parsed.data;
      if (name === "wait_for_events") {
        if (waiting)
          throw failure(
            "wait_in_progress",
            "Only one wait may be active per MCP connection.",
          );
        waiting = true;
        try {
          const { watches, timeoutMs } =
            toolInputs.wait_for_events.parse(input);
          const result = await client.waitForEvents(watches, timeoutMs, signal);
          const connection = result.observations.some((o) => o.task)
            ? await client.connection(signal)
            : undefined;
          return success(
            {
              timedOut: result.timedOut,
              observations: result.observations.map(({ task, ...o }) => ({
                ...o,
                ...(task && connection
                  ? { task: taskSummary(task, o.taskRef, connection) }
                  : {}),
              })),
            },
            result.timedOut
              ? "wait_for_events: timed out with no change."
              : "wait_for_events: task observations available; read histories for details.",
          );
        } finally {
          waiting = false;
        }
      }
      const connection = await client.connection(signal);
      let data: JsonRecord;
      switch (name) {
        case "list_projects": {
          const { limit, offset } = toolInputs.list_projects.parse(input);
          const all = await client.listProjects(signal);
          const rows = all.slice(offset, offset + limit);
          data = {
            connection: {
              targetUrl: connection.targetUrl,
              cezarVersion: connection.cezarVersion,
              compatibility: connection.compatibility,
            },
            projects: rows,
            offset,
            hasMore: offset + rows.length < all.length,
            nextOffset:
              offset + rows.length < all.length ? offset + rows.length : null,
          };
          break;
        }
        case "list_workflows": {
          const { projectId } = toolInputs.list_workflows.parse(input);
          data = {
            projectId,
            ...(await client.listWorkflows(projectId, signal)),
          };
          break;
        }
        case "list_tasks": {
          const { projectId, limit, offset, statuses, query } =
            toolInputs.list_tasks.parse(input);
          const all = (await client.listTasks(projectId, signal))
            .filter(
              (run) =>
                (!statuses || (statuses as string[]).includes(run.status)) &&
                (!query ||
                  `${run.title} ${run.task}`
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase())),
            )
            .sort(
              (a, b) =>
                b.createdAt.localeCompare(a.createdAt) ||
                a.id.localeCompare(b.id),
            );
          const rows = all
            .slice(offset, offset + limit)
            .map((run) =>
              taskSummary(run, { projectId, runId: run.id }, connection),
            );
          data = {
            projectId,
            tasks: rows,
            offset,
            hasMore: offset + rows.length < all.length,
            nextOffset:
              offset + rows.length < all.length ? offset + rows.length : null,
          };
          break;
        }
        case "get_task": {
          const ref = toolInputs.get_task.parse(input);
          let run = await client.getTask(ref, signal);
          const history = await client.readMessages(ref, undefined, signal);
          run = { ...run, pendingQuestion: pendingQuestion(run, history) };
          data = {
            ...taskSummary(run, ref, connection),
            task: run.task,
            steps: stepProjection(run, connection.capabilities),
            ...(run.currentStepId === undefined
              ? {}
              : { currentStepId: run.currentStepId }),
            baseline: {
              ...ref,
              afterSeq: history.asOfSeq,
              state: client.watchState(run),
            },
            ...(run.queuedMessages === undefined
              ? {}
              : { queuedMessages: run.queuedMessages }),
            ...(run.dispatch?.report === undefined
              ? {}
              : { dispatchReport: run.dispatch.report }),
            ...(run.pendingQuestion === undefined
              ? {}
              : { pendingQuestion: run.pendingQuestion }),
          };
          break;
        }
        case "read_messages": {
          const { cursor, ...ref } = toolInputs.read_messages.parse(input);
          const page = await client.readMessages(ref, cursor, signal);
          data = {
            ...ref,
            ...page,
            events: page.events.map((e) =>
              historyEvent(e, connection.capabilities),
            ),
          };
          break;
        }
        case "get_changes": {
          const { view, ...ref } = toolInputs.get_changes.parse(input);
          const changes = await client.getChanges(ref, view, signal);
          data = {
            ...ref,
            cockpitUrl: `${connection.targetUrl}/p/${encodeURIComponent(ref.projectId)}/tasks/${encodeURIComponent(ref.runId)}`,
            ...(typeof changes === "string" ? { diff: changes } : changes),
          };
          break;
        }
        case "create_task": {
          const input = toolInputs.create_task.parse(raw);
          const run = await client.createTask(input, signal);
          data = taskSummary(
            run,
            { projectId: input.projectId, runId: run.id },
            connection,
          );
          if (input.dispatch !== undefined) {
            data.dispatchRequested = true;
            data.dispatchApplied = run.dispatch !== undefined;
          }
          break;
        }
        case "update_task": {
          const { patch, ...ref } = toolInputs.update_task.parse(raw);
          const run = await client.updateTask(ref, patch, signal);
          data = taskSummary(run, ref, connection);
          break;
        }
        case "send_message": {
          const { text, ...ref } = toolInputs.send_message.parse(raw);
          data = { ...ref, ...(await client.sendMessage(ref, text, signal)) };
          break;
        }
        case "continue_task": {
          const { projectId, runId, ...body } =
            toolInputs.continue_task.parse(raw);
          const ref = { projectId, runId };
          data = { ...ref, ...(await client.continueTask(ref, body, signal)) };
          break;
        }
        case "cancel_task": {
          const ref = toolInputs.cancel_task.parse(raw);
          data = { ...ref, ...(await client.cancelTask(ref, signal)) };
          break;
        }
        case "finish_task": {
          const ref = toolInputs.finish_task.parse(raw);
          data = { ...ref, ...(await client.finishTask(ref, signal)) };
          break;
        }
        case "dispatch_task": {
          const { order, ...ref } = toolInputs.dispatch_task.parse(raw);
          const child = await client.dispatchTask(ref, order, signal);
          data = {
            parent: ref,
            projectId: ref.projectId,
            runId: child.id,
            ...(child.branch === undefined ? {} : { branch: child.branch }),
          };
          break;
        }
        default:
          throw failure("invalid_input", "Unknown MCP tool.");
      }
      return success(
        data,
        name === "send_message"
          ? `send_message: ${data.delivered ? "delivered" : data.queued ? "queued; delivery is pending" : "deferred until startup completes"}.`
          : name === "create_task"
            ? `create_task: accepted ${String(data.projectId)}/${String(data.runId)} (${String(data.status)}); worker completion is not implied.`
            : name === "finish_task"
              ? "finish_task: session finished; code approval or merge is not implied."
              : `${name}: request completed.`,
      );
    } catch (error) {
      return errorResult(error);
    }
  };
}
