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
process.env.CODEXMATE_HOME=join(tmpdir(),'codexmate-regression-test-host-'+process.pid);

class Stub extends EventEmitter{
  calls:{method:string;params:any}[]=[];responses:any[]=[];
  async start(){} async request(method:string,params:any){this.calls.push({method,params});return {thread:{id:'thread'},turn:{id:'turn'},data:[]};}
  respond(id:any,value:any){this.responses.push({id,value});}reject(id:any,value:any){this.responses.push({id,error:value});}close(){}
}
async function fixture(){const home=await mkdtemp(join(tmpdir(),'cm-regression-')),db=new ChatStore(home),server=new Stub(),service=new ChatService(db,server as unknown as AppServer);const room:Room={url:'http://127.0.0.1:1',id:randomUUID(),member:randomUUID(),peer:randomUUID(),token:'test',online:true};db.put('settings','room',room);db.put('settings','project',{path:home,remote:'local.git',checks:[],name:'test',grant:{room:room.id,peer:room.peer}});const task:Task={id:randomUUID(),goal:'test',title:'test',created:Date.now(),base:'a'.repeat(40),initiator:room.peer!,path:home,branch:'cm/test',phase:'working',admission:'accepted',wakes:0,budget:20,repairs:0,results:{},thread:'thread'};db.save(task);return {home,db,server,service,room,task,close(){service.close();db.close();}};}
async function until(fn:()=>boolean,timeout=5000){const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw new Error('等待状态超时');await new Promise(r=>setTimeout(r,10));}}
test('manual context uses receiving envelope and never wakes an agent',async()=>{const a=await fixture(),b=await fixture();try{
  b.db.put('settings','room',{...a.room,member:a.room.peer,peer:a.room.member});b.db.save(a.task);b.db.message(a.task.id,'assistant','已完成接口');
  a.db.message(a.task.id,'assistant','已实现本地接口');await a.service.syncContext(a.task.id);
  const event=a.db.list<Wire>('outbox')[0];await (b.service as any).receive(event);
  assert.equal(b.db.list('peerctx').length,1);assert.equal(b.db.list('wake').length,0);assert.equal(b.db.task(a.task.id).phase,'working');
  await a.service.syncContext(a.task.id);assert.equal(a.db.list('outbox').length,1);
}finally{a.close();b.close();}});
test('stop during review aborts checks and cannot restore cancelled state or emit review',async()=>{const f=await fixture();let release!:()=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r);const held=new Promise<void>(r=>release=r);let signal:AbortSignal|undefined;try{
  f.task.phase='reviewing';f.task.integration={sha:'b'.repeat(40),branch:'cm/test',summary:'x',checks:[]};f.task.pendingReview={approved:true,summary:'ok',requestId:randomUUID(),turnId:'turn',sha:'b'.repeat(40),requirements:[],status:'ready'};f.db.save(f.task);
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
test('integration worktree completion merges only its fields into the latest task',async()=>{const f=await fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);try{
  f.task.initiator=f.room.member;f.task.results={[f.room.member]:{sha:'b'.repeat(40),branch:'cm/test/a',summary:'a',checks:[]},[f.room.peer!]:{sha:'c'.repeat(40),branch:'cm/test/b',summary:'b',checks:[]}};f.db.save(f.task);
  (f.service as any).repo=()=>({integrate:async()=>{entered();await gate;return {path:f.home,branch:'cm/test/integration'};}});
  const work=(f.service as any).pump(f.task.id);await started;await f.service.supplement(f.task.id,'整合期间新增的验收条件');const requirement=f.db.list<Wire>('outbox').find(e=>e.type==='supplement')!.id;release();await work;
  assert.ok(f.db.task(f.task.id).requirements?.includes(requirement));assert.equal(f.db.task(f.task.id).branch,'cm/test/integration');
}finally{release?.();f.close();}});
test('submit completion does not overwrite requirements added while the host commit waits',async()=>{const f=await fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);try{
  f.task.initiator=f.room.member;f.task.pendingSubmit={summary:'旧摘要',requestId:randomUUID(),turnId:'turn',requirements:[],status:'ready'};f.db.save(f.task);
  (f.service as any).repo=()=>({commit:async()=>{entered();await gate;return {sha:'b'.repeat(40),branch:'cm/test',summary:'旧摘要',checks:[]};}});
  const work=(f.service as any).finishSubmission(f.task);await started;await f.service.supplement(f.task.id,'提交等待期间新增的要求');const requirement=f.db.list<Wire>('outbox').find(e=>e.type==='supplement')!.id;release();await work;
  assert.ok(f.db.task(f.task.id).requirements?.includes(requirement));assert.equal(f.db.task(f.task.id).pendingSubmit,undefined);assert.equal(f.db.list<Wire>('outbox').some(e=>e.type==='result'),false);
}finally{release?.();f.close();}});
test('review completion does not overwrite requirements added while verification waits',async()=>{const f=await fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);try{
  f.task.phase='reviewing';f.task.integration={sha:'b'.repeat(40),branch:'cm/test',summary:'x',checks:[],requirements:[]};f.task.pendingReview={approved:true,summary:'通过',requestId:randomUUID(),turnId:'turn',sha:'b'.repeat(40),requirements:[],status:'ready'};f.db.save(f.task);
  (f.service as any).repo=()=>({verifyReview:async()=>{entered();await gate;},checks:async()=>[]});
  const work=(f.service as any).finishReview(f.task);await started;await f.service.supplement(f.task.id,'审查期间新增的要求');const requirement=f.db.list<Wire>('outbox').find(e=>e.type==='supplement')!.id;release();await work;
  assert.ok(f.db.task(f.task.id).requirements?.includes(requirement));assert.equal(f.db.task(f.task.id).pendingReview,undefined);assert.equal(f.db.list<Wire>('outbox').some(e=>e.type==='reviewed'),false);
}finally{release?.();f.close();}});
test('second rejected integration review resumes as an initiator repair turn',async()=>{const f=await fixture();try{
  f.task.phase='reviewing';f.task.initiator=f.room.member;f.task.repairs=1;f.task.integration={sha:'b'.repeat(40),branch:'cm/test/integration',summary:'x',checks:[]};f.db.save(f.task);
  await (f.service as any).receive({id:randomUUID(),room:f.room.id,sender:f.room.peer,task:f.task.id,type:'reviewed',at:Date.now(),payload:{approved:false,summary:'缺少边界检查',sha:'b'.repeat(40)}});
  assert.equal(f.db.task(f.task.id).phase,'paused');assert.equal(f.db.task(f.task.id).resumePhase,'integrating');assert.equal(f.db.task(f.task.id).resumeAction,'repair-integration');
  await f.service.resume(f.task.id);await until(()=>f.server.calls.some(c=>c.method==='turn/start'));
  const prompt=f.server.calls.find(c=>c.method==='turn/start')!.params.input[0].text;assert.match(prompt,/缺少边界检查/);assert.equal(f.db.task(f.task.id).phase,'integrating');assert.equal(f.db.task(f.task.id).repairs,0);
}finally{f.close();}});
test('a failed submit_result turn is invalidated and resume asks the Agent to reconcile',async()=>{const f=await fixture();let commits=0;try{
  f.task.turn='turn-1';f.db.save(f.task);(f.service as any).repo=()=>({commit:async()=>{commits++;throw new Error('must not submit');}});
  await (f.service as any).request({id:1,method:'item/tool/call',params:{threadId:'thread',turnId:'turn-1',tool:'submit_result',arguments:{summary:'旧轮次结果'}}});
  assert.equal(f.db.task(f.task.id).pendingSubmit?.status,'awaiting-turn');
  await (f.service as any).notification({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn-1',status:'failed',error:{message:'调用中断'}}}});
  assert.equal(f.db.task(f.task.id).pendingSubmit,undefined);assert.equal(f.db.task(f.task.id).uncertainAction?.kind,'submit');
  await f.service.resume(f.task.id);await until(()=>f.server.calls.some(c=>c.method==='turn/start'));
  assert.equal(commits,0);assert.match(f.server.calls.find(c=>c.method==='turn/start')!.params.input[0].text,/不要重放旧请求/);
}finally{f.close();}});
test('a restarted running submit checks relay and Git reconciliation before any retry',async()=>{const f=await fixture();let reconciles=0,commits=0;try{
  f.task.phase='paused';f.task.resumePhase='working';f.task.pendingSubmit={summary:'可能已提交',requestId:randomUUID(),turnId:'turn-old',requirements:[],status:'running'};f.db.save(f.task);
  (f.service as any).repo=()=>({reconcileCommitted:async()=>{reconciles++;return undefined;},commit:async()=>{commits++;throw new Error('must not retry old submit');}});
  await f.service.resume(f.task.id);await until(()=>f.server.calls.some(c=>c.method==='turn/start'));
  assert.equal(reconciles,1);assert.equal(commits,0);assert.equal(f.db.task(f.task.id).pendingSubmit,undefined);assert.equal(f.db.task(f.task.id).uncertainAction?.kind,'submit');
}finally{f.close();}});
test('a durable result event recovers a submit without recommitting or waking the Agent',async()=>{const f=await fixture();let reconciles=0,commits=0;try{
  const requestId=randomUUID();f.task.phase='paused';f.task.resumePhase='working';f.task.pendingSubmit={summary:'already delivered',requestId,turnId:'turn-old',requirements:[],status:'running'};f.db.save(f.task);
  f.db.put('sent','result-event',{id:'result-event',room:f.room.id,task:f.task.id,sender:f.room.member,type:'result',payload:{sha:'b'.repeat(40),branch:f.task.branch,summary:'already delivered',checks:[],requirements:[]},correlation:requestId,at:Date.now()});
  (f.service as any).repo=()=>({reconcileCommitted:async()=>{reconciles++;throw new Error('event should be sufficient');},commit:async()=>{commits++;throw new Error('must not recommit');}});
  await f.service.resume(f.task.id);await new Promise(r=>setTimeout(r,30));
  assert.equal(reconciles,0);assert.equal(commits,0);assert.equal(f.db.task(f.task.id).pendingSubmit,undefined);assert.equal(f.db.task(f.task.id).results[f.room.member]?.sha,'b'.repeat(40));assert.equal(f.server.calls.some(c=>c.method==='turn/start'),false);
}finally{f.close();}});
test('Git recovery accepts only a clean local HEAD that exactly matches the remote task branch',async()=>{const home=await mkdtemp(join(tmpdir(),'cm-git-reconcile-')),remote=join(home,'remote.git'),root=join(home,'repo'),taskId=randomUUID(),member=randomUUID();await mkdir(remote);await mkdir(root);
  await git(remote,['init','--bare']);await git(remote,['symbolic-ref','HEAD','refs/heads/main']);await git(root,['init','-b','main']);await git(root,['config','user.name','Test']);await git(root,['config','user.email','test@localhost']);await writeFile(join(root,'base.txt'),'base');await git(root,['add','.']);await git(root,['commit','-m','base']);await git(root,['remote','add','origin',remote]);await git(root,['push','-u','origin','main']);
  const base=await git(root,['rev-parse','HEAD']),repo=new Repository({path:root,remote,name:'repo',checks:[]},join(home,'client')),work=await repo.worktree(taskId,member,base);
  const task:Task={id:taskId,title:'reconcile',goal:'reconcile',initiator:member,base,path:work.path,branch:work.branch,phase:'working',admission:'accepted',wakes:0,budget:20,repairs:0,results:{},created:Date.now()};await writeFile(join(work.path,'result.txt'),'published');
  const committed=await repo.commit(task,'confirmed turn'),reconciled=await repo.reconcileCommitted(task,'confirmed turn');assert.equal(reconciled?.sha,committed.sha);assert.equal(reconciled?.branch,work.branch);
  await writeFile(join(work.path,'result.txt'),'changed after publish');assert.equal(await repo.reconcileCommitted(task,'confirmed turn'),undefined,'dirty worktree must not be certified from an old remote SHA');
});
test('an unconfirmed legacy candidate cannot resume a local Agent',async()=>{const f=await fixture();try{
  f.task.phase='paused';f.task.admission='unknown';f.task.admissionEventId=randomUUID();f.db.save(f.task);
  await assert.rejects(()=>f.service.resume(f.task.id),/Agent 不会启动/);assert.equal(f.server.calls.some(c=>c.method==='turn/start'),false);
}finally{f.close();}});
test('simultaneous starts create one relay task and never run the rejected candidate',async()=>{
  const home=await mkdtemp(join(tmpdir(),'cm-start-race-')),relay=createRelay(join(home,'relay'));await new Promise<void>(r=>relay.http.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${(relay.http.address() as any).port}`,aDb=new ChatStore(join(home,'a')),bDb=new ChatStore(join(home,'b')),aServer=new Stub(),bServer=new Stub(),a=new ChatService(aDb,aServer as unknown as AppServer),b=new ChatService(bDb,bServer as unknown as AppServer);
  try{
    const aPair=await a.pair(url),bPair=await b.pair(url,aPair.invite);await until(()=>!!a.snapshot().room?.peer&&!!b.snapshot().room?.peer);
    const aRoot=join(home,'repo-a'),bRoot=join(home,'repo-b');await mkdir(aRoot);await mkdir(bRoot);const remote='https://example.invalid/team/project.git';
    for(const [db,root] of [[aDb,aRoot],[bDb,bRoot]] as const){const room=db.get<Room>('settings','room')!;db.put('settings','project',{path:root,remote,name:'project',checks:[],grant:{room:room.id,peer:room.peer!}});}
    const adapter=(root:string)=>(service:ChatService)=>{(service as any).repo=()=>({base:async()=> 'a'.repeat(40),worktree:async(task:string,member:string,_base:string,kind='work')=>{const path=join(root,task);await mkdir(path,{recursive:true});return {path,branch:`cm/${task}/${member.slice(0,8)}-${kind}`};}});};adapter(aRoot)(a);adapter(bRoot)(b);
    const starts=await Promise.allSettled([a.start('同时发起 A'),b.start('同时发起 B')]);assert.equal(starts.filter(r=>r.status==='fulfilled').length,1);
    await until(()=>aDb.list<Task>('task').some(t=>t.admission==='accepted')&&bDb.list<Task>('task').some(t=>t.admission==='accepted')&&aServer.calls.some(c=>c.method==='turn/start')&&bServer.calls.some(c=>c.method==='turn/start'));
    const activeA=aDb.list<Task>('task').filter(t=>t.admission==='accepted'&&!['complete','cancelled'].includes(t.phase));
    const activeB=bDb.list<Task>('task').filter(t=>t.admission==='accepted'&&!['complete','cancelled'].includes(t.phase));
    assert.equal(activeA.length,1);assert.equal(activeB.length,1);assert.equal(activeA[0].id,activeB[0].id);
    const rejected=[...aDb.list<Task>('task'),...bDb.list<Task>('task')].filter(t=>t.admission==='rejected');assert.equal(rejected.length,1);assert.equal(rejected[0].phase,'cancelled');
    assert.equal(aServer.calls.filter(c=>c.method==='turn/start').length,1);assert.equal(bServer.calls.filter(c=>c.method==='turn/start').length,1);
  }finally{a.close();b.close();await new Promise(r=>setTimeout(r,100));await relay.close();await new Promise(r=>setTimeout(r,100));aDb.close();bDb.close();}
});
test('a peer paused mid-review gets a resumable wake, while the initiator waits for review',async()=>{const f=await fixture();try{
  f.db.put('settings','room',{...f.room,online:false});f.task.phase='paused';f.task.resumePhase='reviewing';f.db.save(f.task);await f.service.resume(f.task.id);assert.equal(f.db.list('wake').length,1);assert.equal(f.db.task(f.task.id).phase,'reviewing');
}finally{f.close();}});
test('oversized websocket frames close only the client, not the relay process',async()=>{const home=await mkdtemp(join(tmpdir(),'cm-frame-')),relay=createRelay(home);await new Promise<void>(r=>relay.http.listen(0,'127.0.0.1',r));const port=(relay.http.address() as any).port;try{const ws=new WebSocket(`ws://127.0.0.1:${port}`);ws.on('error',()=>{});await new Promise<void>(r=>ws.on('open',r));const closed=new Promise<void>(r=>ws.on('close',()=>r()));ws.send('x'.repeat(129*1024));await closed;assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);}finally{await relay.close();}});
