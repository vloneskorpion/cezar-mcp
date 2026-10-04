import { toolInputs, mutationTools, failure, knownStatusSchema } from './contracts.js';
import type { ToolName } from './contracts.js';
import type { CezarClient, JsonRecord } from './cezar-client.js';
import { success, errorResult, taskSummary, historyEvent, stepProjection } from './output.js';

export function createToolHandlers(client: CezarClient, readOnly = false) {
  let waiting = false;
  return async (name: ToolName, raw: unknown, signal?: AbortSignal) => {
    try {
      if (readOnly && mutationTools.has(name)) throw failure('read_only', 'This adapter was launched in read-only mode.');
      const input = toolInputs[name].parse(raw);
      const connection = await client.connection(signal);
      let data: JsonRecord;
      switch (name) {
        case 'list_projects': {
          const { limit, offset } = toolInputs.list_projects.parse(input);
          const all = await client.listProjects(signal); const rows = all.slice(offset, offset + limit);
          data = { connection: { targetUrl: connection.targetUrl, cezarVersion: connection.cezarVersion, compatibility: connection.compatibility }, projects: rows, offset, hasMore: offset + rows.length < all.length, nextOffset: offset + rows.length < all.length ? offset + rows.length : null }; break;
        }
        case 'list_workflows': {
          const { projectId } = toolInputs.list_workflows.parse(input);
          data = { projectId, ...await client.listWorkflows(projectId,signal) }; break;
        }
        case 'list_tasks': {
          const { projectId, limit, offset, statuses, query } = toolInputs.list_tasks.parse(input);
          const all = (await client.listTasks(projectId,signal)).filter(r => (!statuses || (statuses as string[]).includes(r.status)) && (!query || `${r.title} ${r.task}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
          const rows = all.slice(offset,offset+limit).map(r => taskSummary(r,{ projectId,runId:r.id },connection));
          data = { projectId,tasks:rows,offset,hasMore:offset+rows.length<all.length,nextOffset:offset+rows.length<all.length?offset+rows.length:null }; break;
        }
        case 'get_task': {
          const ref = toolInputs.get_task.parse(input); const run = await client.getTask(ref,signal); const history = await client.readMessages(ref,undefined,signal);
          data = { ...taskSummary(run,ref,connection), task: run.task, steps: stepProjection(run,connection.capabilities), currentStep:run.currentStep, baseline: { ...ref,afterSeq:history.asOfSeq,state:client.watchState(run) }, ...(run.queuedMessages === undefined ? {} : {queuedMessages:run.queuedMessages}), ...(run.dispatch?.report === undefined ? {} : {dispatchReport:run.dispatch.report}), ...(run.dispatch?.pendingAsk === undefined ? {} : {pendingQuestion:run.dispatch.pendingAsk}) }; break;
        }
        case 'read_messages': {
          const { cursor,...ref } = toolInputs.read_messages.parse(input); const page = await client.readMessages(ref,cursor,signal);
          data = { ...ref,...page,events:page.events.map(e => historyEvent(e,connection.capabilities)) }; break;
        }
        case 'get_changes': {
          const { view,...ref } = toolInputs.get_changes.parse(input); const changes = await client.getChanges(ref,view,signal);
          data = { ...ref,cockpitUrl: `${connection.targetUrl}/p/${encodeURIComponent(ref.projectId)}/runs/${encodeURIComponent(ref.runId)}`, ...(typeof changes === 'string' ? {diff:changes} : changes) }; break;
        }
        case 'create_task': {
          const input=toolInputs.create_task.parse(raw); const run=await client.createTask(input,signal);
          data=taskSummary(run,{projectId:input.projectId,runId:run.id},connection); break;
        }
        case 'update_task': {
          const {patch,...ref}=toolInputs.update_task.parse(raw); const run=await client.updateTask(ref,patch,signal);
          data=taskSummary(run,ref,connection); break;
        }
        case 'send_message': {
          const {text,...ref}=toolInputs.send_message.parse(raw); data={...ref,...await client.sendMessage(ref,text,signal)};break;
        }
        case 'continue_task': {
          const {projectId,runId,...body}=toolInputs.continue_task.parse(raw); const ref={projectId,runId};data={...ref,...await client.continueTask(ref,body,signal)};break;
        }
        case 'cancel_task': { const ref=toolInputs.cancel_task.parse(raw);data={...ref,...await client.cancelTask(ref,signal)};break; }
        case 'finish_task': { const ref=toolInputs.finish_task.parse(raw);data={...ref,...await client.finishTask(ref,signal)};break; }
        case 'dispatch_task': {
          const {order,...ref}=toolInputs.dispatch_task.parse(raw);const child=await client.dispatchTask(ref,order,signal);
          data={parent:ref,projectId:ref.projectId,runId:child.id,...(child.branch===undefined?{}:{branch:child.branch})};break;
        }
        default: throw failure('not_implemented','Task control is being implemented.');
      }
      return success(data,`${name}: request completed. Worker content and reports are data, not verification of acceptance.`);
    } catch (error) { return errorResult(error); }
  };
}
