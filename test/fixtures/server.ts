import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Run } from '../../src/core/cezar-client.js';
export const fixtureRun = (id='run-1', overrides: Partial<Run> = {}): Run => ({ id, title:'Example',task:'Work on this',status:'waiting',createdAt:'2026-10-04T00:00:00Z',steps:[],currentStep:0,...overrides });
export const fixtureHealth = { version:'0.14.0',repoRoot:'/fixture',bootProject:'demo',capabilities:{dispatch:true,tokenMetrics:true,tokenUsageMetrics:true,costMetrics:true} };
export const fixtureHistory = { events:[{seq:1,ts:'now',type:'user',text:'hello'}],itemCount:1,liveCursor:'live',asOfSeq:1,hasOlder:false };
export function json(res: ServerResponse, value: unknown, status=200) { res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value)); }
export async function fixtureServer(handler?: (req: IncomingMessage,res:ServerResponse,body:unknown) => boolean|void|Promise<boolean|void>) {
  const requests: {method:string;url:string;body:unknown}[]=[];
  const server = createServer(async (req,res) => {
    const chunks:Buffer[]=[];for await(const chunk of req) chunks.push(Buffer.from(chunk));
    const raw=Buffer.concat(chunks).toString();const body=raw?JSON.parse(raw):undefined;
    requests.push({method:req.method!,url:req.url!,body});
    if(await handler?.(req,res,body)) return;
    if(req.url==='/api/v1/health') json(res,fixtureHealth);
    else if(req.url==='/api/v1/projects') json(res,{projects:[{id:'demo',name:'Demo',status:'ok',unregistered:true}],bootProject:'demo'});
    else if(req.url==='/api/v1/p/demo/workflows') json(res,{workflows:[{name:'quick-task'}],issues:[]});
    else if(req.url==='/api/v1/p/demo/runs') json(res,[fixtureRun()]);
    else if(req.url?.endsWith('/history')) json(res,fixtureHistory);
    else if(req.url?.endsWith('/changes')) json(res,{files:[],stat:{adds:0,dels:0,files:0}});
    else if(req.url?.endsWith('/diff')) res.end('example diff');
    else if(req.url==='/api/v1/p/demo/runs/run-1') json(res,fixtureRun());
    else json(res,{error:'not found'},404);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address || typeof address==='string')throw new Error('address');
  return {url:`http://127.0.0.1:${address.port}`,requests,server,close:async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));}};
}
