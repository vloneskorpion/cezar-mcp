import { CezarError, failure } from '../core/contracts.js';
import type { WatchBaseline, ToolError } from '../core/contracts.js';
import type { CezarClient, Run, WaitObservation, WaitResult } from '../core/cezar-client.js';
import { runWire, eventWire } from './wire.js';
import { parseJson, requestScope } from './transport.js';

export const SSE_FRAME_BYTES = 1024 * 1024;
interface Frame { event: string; data: string; id?: string }
/** Incremental SSE parser: CRLF/CR/LF, comments, multiline data, split UTF-8, bounded frames. */
export async function consumeSse(response: Response, onFrame: (frame: Frame) => void): Promise<void> {
  if (!response.body) throw failure('resync_required','The task stream had no body.');
  const reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});const encoder=new TextEncoder();
  let buffer='';let data:string[]=[];let event='message';let id:string|undefined;let frameBytes=0;
  const line=(value:string)=>{
    frameBytes+=encoder.encode(value).length+1;
    if(frameBytes>SSE_FRAME_BYTES)throw failure('response_too_large','An SSE frame exceeded the byte limit.');
    if(!value){if(data.length)onFrame({event,data:data.join('\n'),...(id===undefined?{}:{id})});data=[];event='message';id=undefined;frameBytes=0;return;}
    if(value.startsWith(':'))return;
    const colon=value.indexOf(':');const key=colon<0?value:value.slice(0,colon);let content=colon<0?'':value.slice(colon+1);if(content.startsWith(' '))content=content.slice(1);
    if(key==='data')data.push(content);else if(key==='event')event=content;else if(key==='id'&&!content.includes('\0'))id=content;
  };
  try{
    while(true){
      const {done,value}=await reader.read();if(done)throw failure('resync_required','The task stream closed. Fetch a new task/history baseline.');
      buffer+=decoder.decode(value,{stream:true});
      let start=0;
      for(let i=0;i<buffer.length;i++){
        const c=buffer[i];if(c!=='\r'&&c!=='\n')continue;
        if(c==='\r'&&i===buffer.length-1)break; // A CRLF can be split across chunks.
        line(buffer.slice(start,i));if(c==='\r'&&buffer[i+1]==='\n')i++;start=i+1;
      }
      buffer=buffer.slice(start);
      if(frameBytes+encoder.encode(buffer).length>SSE_FRAME_BYTES)throw failure('response_too_large','An SSE frame exceeded the byte limit.');
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
// item.updated can be persisted OR ephemeral; only history can establish its durable seq.
const durableType = /^(?:session\.(?:started|ended|error)|turn\.(?:started|completed)|item\.(?:started|completed)|plan\.updated|permission\.(?:requested|resolved)|ask\.requested|usage\.updated|user|assistant|text|tool|tool_result|result|error|done|step-start|step-end|run-start|run-end|message|system|status)$/;
interface Entry { input: WatchBaseline; observation: WaitObservation; run?: Run; candidateRun?: Run; seq: number; ready: boolean; ambiguousEvent: boolean }
export async function watchTasks(client: CezarClient, watches: WatchBaseline[], timeoutMs: number, options: { signal?: AbortSignal; lifetime: AbortSignal; open: (baseline:WatchBaseline,signal:AbortSignal)=>Promise<Response> }): Promise<WaitResult> {
  if(timeoutMs===0)return {timedOut:true,observations:watches.map(w=>({taskRef:{projectId:w.projectId,runId:w.runId},baseline:w,kinds:[]}))};
  const scope=requestScope([options.signal,options.lifetime],timeoutMs);
  const streams:Promise<void>[]=[];const entries:Entry[]=watches.map(input=>({input,observation:{taskRef:{projectId:input.projectId,runId:input.runId},kinds:[]},seq:input.afterSeq,ready:false,ambiguousEvent:false}));
  let finishing=false;let wake!:()=>void;let notification= new Promise<void>(r=>{wake=r;});
  const notify=()=>wake();
  const addKind=(entry:Entry,kind:WaitObservation['kinds'][number])=>{if(!entry.observation.kinds.includes(kind))entry.observation.kinds.push(kind);if(entry.ready)notify();};
  const updateRun=(entry:Entry,run:Run)=>{
    if(run.id!==entry.input.runId)throw failure('resync_required','The stream task identity changed.');
    entry.run=run;
    if(JSON.stringify(client.watchState(run))!==JSON.stringify(entry.input.state))addKind(entry,'state_changed');
  };
  const markError=(entry:Entry,error:unknown)=>{
    const detail:ToolError=error instanceof CezarError?error.detail:failure('resync_required','The task stream was interrupted; fetch a new baseline.').detail;
    entry.observation.error=detail;notify();
  };
  const abortWake=()=>notify();scope.signal.addEventListener('abort',abortWake,{once:true});
  try{
    await client.connection(scope.signal);
    await Promise.all(entries.map(async entry=>{
      try{
        const response=await options.open(entry.input,scope.signal);
        const stream=consumeSse(response,frame=>{
          if(finishing||frame.event==='ping')return;
          if(frame.event==='run'){
            const run=runWire.parse(parseJson(frame.data));entry.candidateRun=run;if(entry.ready)updateRun(entry,run);
          }else if(frame.event==='run-event'||frame.event==='ui-event'){
            const event=eventWire.parse(parseJson(frame.data));
            if(event.type==='item.delta'||event.type==='delta')return;
            if(durableType.test(event.type)){
              entry.seq=Math.max(entry.seq,event.seq);
              if(event.seq>entry.input.afterSeq)addKind(entry,'transcript_available');
            }else{entry.ambiguousEvent=true;if(entry.ready)notify();}
          }else if(frame.event==='run-deleted'){throw failure('not_found','The watched task was deleted.');}
        }).catch(error=>{if(!finishing&&!scope.signal.aborted)markError(entry,error);});
        streams.push(stream);
        const [run,history]=await Promise.all([client.getTask(entry.observation.taskRef,scope.signal),client.readMessages(entry.observation.taskRef,undefined,scope.signal)]);
        if(entry.input.afterSeq>history.asOfSeq)throw failure('resync_required','The baseline sequence is newer than durable history; fetch a new baseline.');
        // Snapshot is read after opening the stream; a run frame observed during that read takes precedence.
        updateRun(entry,entry.candidateRun??run);
        entry.seq=Math.max(entry.seq,history.asOfSeq);
        if(history.asOfSeq>entry.input.afterSeq)addKind(entry,'transcript_available');
        entry.ready=true;
      }catch(error){if(!scope.signal.aborted)markError(entry,error);}
    }));
    while(!scope.signal.aborted && !entries.some(e=>e.observation.error||e.observation.kinds.length)){
      if(entries.some(e=>e.ambiguousEvent)){
        await Promise.all(entries.filter(e=>e.ambiguousEvent).map(async entry=>{
          entry.ambiguousEvent=false;
          try{const history=await client.readMessages(entry.observation.taskRef,undefined,scope.signal);entry.seq=Math.max(entry.seq,history.asOfSeq);if(history.asOfSeq>entry.input.afterSeq)addKind(entry,'transcript_available');}catch(error){if(!scope.signal.aborted)markError(entry,error);}
        }));
        continue;
      }
      notification=new Promise<void>(r=>{wake=r;});
      await notification;
    }
    if(options.signal?.aborted||options.lifetime.aborted)throw failure('request_cancelled','Event waiting was cancelled; no cezar task was cancelled.');
    // Allow already-buffered observations from all workers to coalesce without a background subscription.
    if(!scope.signal.aborted)await new Promise<void>(r=>setTimeout(r,0));
    for(const entry of entries){
      if(entry.run)entry.observation.task=entry.run;
      if(!entry.observation.error)entry.observation.baseline={...entry.input,afterSeq:entry.seq,state:entry.run?client.watchState(entry.run):entry.input.state};
    }
    return {timedOut:!entries.some(e=>e.observation.kinds.length||e.observation.error),observations:entries.map(e=>e.observation)};
  }catch(error){
    if(scope.signal.aborted&&!options.signal?.aborted&&!options.lifetime.aborted)return {timedOut:true,observations:entries.map(e=>({...e.observation,baseline:e.input}))};
    throw error;
  }finally{finishing=true;scope.abort();scope.signal.removeEventListener('abort',abortWake);scope.dispose();await Promise.allSettled(streams);}
}
