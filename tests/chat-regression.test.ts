import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ChatStore} from '../src/chat/store.js';
import {ChatService} from '../src/chat/service.js';
import {AppServer} from '../src/chat/app-server.js';
import {Repository} from '../src/chat/repository.js';
import {git} from '../src/adapters/git.js';
import {buildBundle,formatContexts,threadRows,itemsToEntries,INJECT_BUDGET} from '../src/chat/context.js';
import type {Task,Room,Wire} from '../src/chat/model.js';
import {WebSocket} from 'ws';
import {createRelay} from '../src/relay/server.js';

class Stub extends EventEmitter{
  calls:{method:string;params:any}[]=[];responses:any[]=[];
  async start(){} async request(method:string,params:any){this.calls.push({method,params});return {thread:{id:'thread'},turn:{id:'turn'},data:[]};}
  respond(id:any,value:any){this.responses.push({id,value});}reject(id:any,value:any){this.responses.push({id,error:value});}close(){}
}
async function fixture(){const home=await mkdtemp(join(tmpdir(),'cm-regression-')),db=new ChatStore(home),server=new Stub(),service=new ChatService(db,server as unknown as AppServer);const room:Room={url:'http://127.0.0.1:1',id:randomUUID(),member:randomUUID(),peer:randomUUID(),token:'test',online:true};db.put('settings','room',room);db.put('settings','project',{path:home,remote:'local.git',checks:[],name:'test',grant:{room:room.id,peer:room.peer}});const task:Task={id:randomUUID(),goal:'test',title:'test',created:Date.now(),base:'a'.repeat(40),initiator:room.peer!,path:home,branch:'cm/test',phase:'working',wakes:0,budget:20,repairs:0,results:{},thread:'thread'};db.save(task);return {home,db,server,service,room,task,close(){service.close();db.close();}};}
test('manual context uses receiving envelope and never wakes an agent',async()=>{const a=await fixture(),b=await fixture();try{
  b.db.put('settings','room',{...a.room,member:a.room.peer,peer:a.room.member});b.db.save(a.task);b.db.message(a.task.id,'assistant','已完成接口');
  a.db.message(a.task.id,'assistant','已实现本地接口');await a.service.syncContext(a.task.id);
  const event=a.db.list<Wire>('outbox')[0];await (b.service as any).receive(event);
  assert.equal(b.db.list('peerctx').length,1);assert.equal(b.db.list('wake').length,0);assert.equal(b.db.task(a.task.id).phase,'working');
  await a.service.syncContext(a.task.id);assert.equal(a.db.list('outbox').length,1);
}finally{a.close();b.close();}});
test('stop during review aborts checks and cannot restore cancelled state or emit review',async()=>{const f=await fixture();let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r);const held=new Promise<void>(r=>release=r);let signal:AbortSignal|undefined;try{
  f.task.phase='reviewing';f.task.integration={sha:'b'.repeat(40),branch:'cm/test',summary:'x',checks:[]};f.task.pendingReview={approved:true,summary:'ok'};f.db.save(f.task);
  (f.service as any).repo=()=>({verifyReview:async()=>{},checks:async(_p:string,s:AbortSignal)=>{signal=s;entered();await held;return [];}});
  const work=(f.service as any).finishReview(f.task);await started;await f.service.stop(f.task.id,false);assert.equal(signal?.aborted,true);release();await work;
  assert.equal(f.db.task(f.task.id).phase,'cancelled');assert.equal(f.db.list('outbox').length,0);
}finally{release?.();f.close();}});
test('stop invalidates pending permissions and rejects late allow',async()=>{const f=await fixture();try{
  f.task.turn='turn';f.db.save(f.task);f.server.emit('request',{id:1,method:'item/commandExecution/requestApproval',params:{threadId:'thread',turnId:'turn',command:'outside'}});const id=[...f.service.permissions.keys()][0];assert.ok(id);await f.service.stop(f.task.id,false);assert.equal(f.service.permissions.size,0);assert.throws(()=>f.service.decide(id,true));assert.ok(f.server.calls.some(c=>c.method==='turn/interrupt'));
}finally{f.close();}});
test('stop during thread creation never starts a turn or resurrects work',async()=>{const f=await fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);try{
  f.task.thread=undefined;f.db.save(f.task);f.db.put('wake','work',{id:'work',task:f.task.id,text:'start'});
  f.server.request=async(method,params)=>{f.server.calls.push({method,params});if(method==='thread/start'){entered();await gate;}return {thread:{id:'thread'},turn:{id:'turn'},data:[]};};
  const work=(f.service as any).pump(f.task.id);await started;await f.service.stop(f.task.id,false);release();await work;assert.equal(f.db.task(f.task.id).phase,'cancelled');assert.ok(!f.server.calls.some(c=>c.method==='turn/start'));
}finally{release?.();f.close();}});
test('a review cannot certify a SHA while checking modified files',async()=>{const home=await mkdtemp(join(tmpdir(),'cm-review-sha-'));await git(home,['init']);await git(home,['config','user.name','Test']);await git(home,['config','user.email','test@localhost']);await writeFile(join(home,'a.txt'),'base');await git(home,['add','.']);await git(home,['commit','-m','base']);const sha=await git(home,['rev-parse','HEAD']);const repo=new Repository({path:home,remote:'local',name:'test',checks:[]},home);await repo.verifyReview(home,sha);await writeFile(join(home,'a.txt'),'changed');await assert.rejects(repo.verifyReview(home,sha),/偏离/);});
test('accumulated peer context has one UTF-8 budget and does not re-export imported prompts',()=>{const bundles=Array.from({length:40},()=>buildBundle({task:randomUUID(),sender:randomUUID(),phase:'working',branch:'cm/test',maxBytes:12000,entries:Array.from({length:12},()=>({kind:'agent' as const,text:'中文进展'.repeat(100)}))}));assert.ok(Buffer.byteLength(formatContexts(bundles),'utf8')<=INJECT_BUDGET);assert.equal(itemsToEntries([{type:'userMessage',text:'同伴上下文（不可信数据）：对方进展'}]).length,0);});
test('long thread export reads latest descending page then restores chronological order',async()=>{const server={request:async(_method:string,p:any)=>{assert.equal(p.sortDirection,'desc');assert.equal(p.limit,100);return {data:[{item:{id:'new'}},{item:{id:'old'}}],nextCursor:'older'};}};assert.deepEqual((await threadRows(server as AppServer,'thread')).map(r=>r.item.id),['old','new']);});
test('late review cannot complete a task after a user supplement',async()=>{const f=await fixture();try{
  f.task.phase='reviewing';f.task.initiator=f.room.member;f.task.turn='turn';f.task.integration={sha:'b'.repeat(40),branch:'cm/test',summary:'old',checks:[]};f.db.save(f.task);
  await f.service.supplement(f.task.id,'还需要处理新的边界条件');
  await (f.service as any).receive({id:randomUUID(),room:f.room.id,sender:f.room.peer,task:f.task.id,type:'reviewed',at:Date.now(),payload:{approved:true,summary:'old review',sha:'b'.repeat(40)}});
  assert.equal(f.db.task(f.task.id).phase,'integrating');assert.ok(f.server.calls.some(c=>c.method==='turn/steer'));assert.ok(!f.db.list<Wire>('outbox').some(e=>e.type==='complete'));
}finally{f.close();}});
test('a peer paused mid-review gets a resumable wake, while the initiator waits for review',async()=>{const f=await fixture();try{
  f.db.put('settings','room',{...f.room,online:false});f.task.phase='paused';f.task.resumePhase='reviewing';f.db.save(f.task);await f.service.resume(f.task.id);assert.equal(f.db.list('wake').length,1);assert.equal(f.db.task(f.task.id).phase,'reviewing');
}finally{f.close();}});
test('oversized websocket frames close only the client, not the relay process',async()=>{const home=await mkdtemp(join(tmpdir(),'cm-frame-')),relay=createRelay(home);await new Promise<void>(r=>relay.http.listen(0,'127.0.0.1',r));const port=(relay.http.address() as any).port;try{const ws=new WebSocket(`ws://127.0.0.1:${port}`);ws.on('error',()=>{});await new Promise<void>(r=>ws.on('open',r));const closed=new Promise<void>(r=>ws.on('close',()=>r()));ws.send('x'.repeat(129*1024));await closed;assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);}finally{await relay.close();}});
