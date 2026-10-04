import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpCezarClient } from '../../src/cezar/http-client.js';
import { createToolHandlers } from '../../src/core/tools.js';
import { fixtureServer,json,fixtureRun,fixtureHealth } from '../fixtures/server.js';
const ref={projectId:'demo',runId:'run-1'};
test('all writes use fixed scoped routes and exact request bodies',async()=>{
  const fixture=await fixtureServer((req,res,body)=>{
    if(req.method==='PATCH'){json(res,fixtureRun('run-1',{title:(body as {title:string}).title}));return true;}
    if(req.method==='POST'){
      if(req.url?.endsWith('/runs'))json(res,fixtureRun('created',{status:'queued'}),201);
      else if(req.url?.endsWith('/messages'))json(res,{queued:true,message:{id:'m',createdAt:'now',text:'private additional field'}});
      else if(req.url?.endsWith('/continue'))json(res,{continued:true});
      else if(req.url?.endsWith('/cancel'))json(res,{cancelled:false});
      else if(req.url?.endsWith('/finish'))json(res,{finished:true});
      else if(req.url?.endsWith('/dispatch'))json(res,{id:'child'});
      return true;
    }
  });const client=new HttpCezarClient({url:fixture.url});
  try{
    const run=await client.createTask({projectId:'demo',task:'exact',workflow:'quick-task'});assert.equal(run.id,'created');
    assert.deepEqual(fixture.requests.find(r=>r.method==='POST')?.body,{task:'exact',workflow:'quick-task',variants:1,worktree:true});
    const text='/om-fix\n  Keep spacing  ';const message=await client.sendMessage(ref,text);assert.deepEqual(message,{queued:true,message:{id:'m',createdAt:'now'}});
    assert.deepEqual(fixture.requests.find(r=>r.url.endsWith('/messages'))?.body,{text});
    await client.updateTask(ref,{title:'Updated'});await client.continueTask(ref,{text,runner:'claude',model:'specific'});
    assert.deepEqual(await client.cancelTask(ref),{cancelled:false});await client.finishTask(ref);
    assert.deepEqual(await client.dispatchTask(ref,{objective:'review',kind:'review'}),{id:'child'});
    assert.equal(fixture.requests.filter(r=>r.method==='POST'||r.method==='PATCH').length,7);
  }finally{client.close();await fixture.close();}
});
test('read-only core dispatch refuses writes without a request',async()=>{
  const fixture=await fixtureServer();const client=new HttpCezarClient({url:fixture.url});
  try{const result=await createToolHandlers(client,true)('send_message',{...ref,text:'write'});assert.equal(result.structuredContent.ok,false);assert.equal(fixture.requests.length,0);}finally{client.close();await fixture.close();}
});
test('unknown statuses and disabled dispatch creation prevent mutation',async()=>{
  const fixture=await fixtureServer((req,res)=>{
    if(req.url==='/api/v1/health'){json(res,{...fixtureHealth,capabilities:{...fixtureHealth.capabilities,dispatch:false}});return true;}
    if(req.url==='/api/v1/p/demo/runs/run-1'){json(res,fixtureRun('run-1',{status:'future'}));return true;}
  });const client=new HttpCezarClient({url:fixture.url});
  try{await assert.rejects(client.cancelTask(ref),/unsupported/);await assert.rejects(client.createTask({projectId:'demo',task:'x',workflow:'quick-task',dispatch:{}}),/disabled/);assert.equal(fixture.requests.some(r=>r.method==='POST'),false);}finally{client.close();await fixture.close();}
});
