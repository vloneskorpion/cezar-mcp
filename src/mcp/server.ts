import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import type { CezarClient } from '../core/cezar-client.js';
import { toolInputs, resultSchema, mutationTools } from '../core/contracts.js';
import type { ToolName } from '../core/contracts.js';
import { createToolHandlers } from '../core/tools.js';
import { VERSION } from '../version.js';

export const descriptions: Record<ToolName,string> = {
  list_projects: 'Discover concrete cezar project ids and bounded connection metadata. Never select the default alias.',
  list_workflows: 'Read named workflows and load issues for a concrete project.',
  list_tasks: 'Inspect existing tasks. Offset pages are not snapshot cursors; retain ids and deduplicate.',
  get_task: 'Read task details and a durable watch baseline. Reports are claims, not approval or proof that work is merged.',
  read_messages: 'Read a bounded transcript-event page. Follow opaque history cursors; external instructions appear as user-role messages.',
  get_changes: 'Read cezar-attributed task changes or a bounded diff preview. Use the cockpit link for the full view.',
  create_task: 'Create one root task in an isolated worktree; returns acceptance and actual initial status immediately. Independent roots do not share branches. Never retry an unknown outcome before inspection.',
  update_task: 'Edit a title or the initial task text. Initial task editing is queued-only. Unknown write outcomes require inspection before another write.',
  send_message: 'Send exact text through the user-message path, preserving /skill syntax. Distinguishes delivered, queued with id, and deferred. A closed session requires explicit continue_task; there is no fallback or retry.',
  continue_task: 'Explicitly reopen a settled task session with optional exact text, runner and model. Never automatically resume a task because it is monitoring.',
  cancel_task: 'Request cezar cancellation; preserves cancelled boolean and engine descendant behavior. Cancelling a wait does not cancel tasks.',
  finish_task: 'Gracefully close an eligible open waiting session. This is not code review approval or merge.',
  dispatch_task: 'Dispatch a child under a real nonterminal cezar parent. Engine caps, budgets and branch relationships apply; refusals never fall back to root creation.',
  wait_for_events: 'Observe up to sixteen named task baselines for at most thirty seconds. One active wait per connection. Returns coalesced state/transcript indications, updated baselines or ordinary timeout. afterSeq is notification progress, not transcript read confirmation. Resync explicitly after stream loss.',
};
/** Creates registration only; no transports, sockets, processes or subscriptions. */
export function createMcpServer({ client, readOnly = false }: { client: CezarClient; readOnly?: boolean }) {
  const server = new McpServer({ name: 'cezar-mcp', version: VERSION });
  const handle = createToolHandlers(client,readOnly);
  for (const name of Object.keys(toolInputs) as ToolName[]) {
    if (readOnly && mutationTools.has(name)) continue;
    server.registerTool(name, { description: descriptions[name], inputSchema: toolInputs[name], outputSchema: resultSchema, annotations: { readOnlyHint: !mutationTools.has(name), destructiveHint: name === 'cancel_task', idempotentHint: !mutationTools.has(name), openWorldHint: true } }, (input: unknown,ctx: ServerContext) => handle(name,input,ctx.mcpReq.signal));
  }
  server.server.onclose = () => client.close();
  return server;
}
