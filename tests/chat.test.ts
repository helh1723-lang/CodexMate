import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRelay } from '../src/relay/server.js';
import { ChatStore } from '../src/chat/store.js';
import { ChatService } from '../src/chat/service.js';
import { AppServer } from '../src/chat/app-server.js';
import { RelayClient,relayUrl } from '../src/chat/relay-client.js';
import { git } from '../src/adapters/git.js';
import type { Task,Room,Wire } from '../src/chat/model.js';
import { itemsToEntries, fit, rowsAfter, formatPeerContext, buildBundle, contextBundleSchema, SYNC_BUDGET_AUTO, INJECT_BUDGET, RECENT_KEEP } from '../src/chat/context.js';
const sleep=(ms=30)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean,timeout=15000){const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw new Error('等待状态超时');await sleep();}}
async function relayFixture(){const home=await mkdtemp(join(tmpdir(),'cm-relay-')),relay=createRelay(home);await new Promise<void>(r=>relay.http.listen(0,'127.0.0.1',r));const a=relay.http.address() as any,url=`http://127.0.0.1:${a.port}`;return {...relay,url,home};}
async function post(url:string,path:string,body={}){const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};}
test('relay requires TLS except loopback and rejects embedded credentials',()=>{assert.throws(()=>relayUrl('http://example.com'));assert.throws(()=>relayUrl('https://secret@example.com'));assert.equal(relayUrl('http://127.0.0.1:8787/'),'http://127.0.0.1:8787');});
test('durable relay pairs only two, deduplicates, replays cancellation before pending work',async()=>{
  const relay=await relayFixture(),a=(await post(relay.url,'/rooms')).data,b=(await post(relay.url,'/join',{invite:a.invite})).data;
  assert.equal((await post(relay.url,'/join',{invite:a.invite})).status,400);
  const da=new ChatStore(join(relay.home,'a')),db=new ChatStore(join(relay.home,'b'));
  const ca=new RelayClient(da,{...a,url:relay.url}),cb=new RelayClient(db,{...b,url:relay.url});
  try{ca.connect();cb.connect();await until(()=>!!ca.room.online);
    const task=randomUUID(),event:Wire={id:randomUUID(),room:a.id,sender:a.member,task,type:'start',payload:{goal:'hello'},at:Date.now()};da.enqueue(event);ca.flush();await until(()=>db.list('inbox').length===1);da.enqueue(event);ca.flush();await sleep(150);assert.equal(db.list('inbox').length,1);
    cb.close();await until(()=>!ca.room.online);const cancel:Wire={...event,id:randomUUID(),type:'cancel',payload:{}};da.enqueue(cancel);ca.flush();await until(()=>!da.list('outbox').length);cb.connect();await until(()=>!!db.get('cancel',task));assert.equal(db.list<Wire>('inbox').filter(e=>e.type==='cancel').length,1);
    assert.equal(relay.db.list('event').length,2);
  }finally{ca.close();cb.close();await sleep();da.close();db.close();await relay.close();}
});
class FakeCodex extends EventEmitter{
  threads=new Map<string,{cwd:string}>();pending=new Map<string,(r:any)=>void>();starts=0;prompts:string[]=[];
  async start(){}
  async request(method:string,p:any){
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method==='thread/start'){const id=randomUUID();this.threads.set(id,{cwd:p.cwd});return {thread:{id}};}
    if(method==='thread/resume')return {};
    if(method==='turn/start'){const turn=randomUUID();this.starts++;this.prompts.push(p.input[0].text);setTimeout(()=>void this.run(p.threadId,turn,p.input[0].text),10);return {turn:{id:turn}};}
    if(method==='turn/steer'||method==='turn/interrupt')return {};
    throw new Error('Unknown method '+method);
  }
  async tool(thread:string,turn:string,name:string,args:any){const id=randomUUID();const done=new Promise(r=>this.pending.set(id,r));this.emit('request',{id,method:'item/tool/call',params:{threadId:thread,turnId:turn,callId:id,tool:name,arguments:args}});return done;}
  async run(thread:string,turn:string,text:string){try{
    const cwd=this.threads.get(thread)!.cwd;
    // 标签刻意不复用上面的分支关键字，避免同步过去的上下文反向命中同伴的分派逻辑。
    const label=text.includes('审查整合成果')?'已检查双方改动与约定接口'
      :text.includes('独立集成工作树')?'已整合双方提交'
      :text.includes('你是发起方')?'已提出分工与接口约定'
      :text.includes('分工：')?'已按接口完成 b.txt'
      :text.includes('已确认')?'已完成 a.txt':'进展';
    this.emit('notification',{method:'item/agentMessage/delta',params:{threadId:thread,itemId:'reply-'+turn,delta:label}});
    this.emit('notification',{method:'item/completed',params:{threadId:thread,item:{type:'commandExecution',command:'node -e check',aggregatedOutput:'ok',exitCode:0}}});
    if(text.includes('审查整合成果')){assert.equal(await readFile(join(cwd,'a.txt'),'utf8'),'interface:v1');assert.equal(await readFile(join(cwd,'b.txt'),'utf8'),'uses interface:v1');await this.tool(thread,turn,'submit_review',{approved:true,summary:'检查到双方实际修改及约定接口。'});}
    else if(text.includes('独立集成工作树'))await this.tool(thread,turn,'submit_result',{summary:'整合 A 和 B 的实际代码。'});
    else if(text.includes('你是发起方')){await this.tool(thread,turn,'peer_send',{message:'分工：我写 a.txt，接口 interface:v1；请你确认并写 b.txt 引用它。'});}
    else if(text.includes('分工：')){await writeFile(join(cwd,'b.txt'),'uses interface:v1');await this.tool(thread,turn,'peer_send',{message:'已确认 interface:v1，我完成 b.txt。请完成 a.txt。'});await this.tool(thread,turn,'submit_result',{summary:'B 按收到的接口完成代码。'});}
    else if(text.includes('已确认')){await writeFile(join(cwd,'a.txt'),'interface:v1');await this.tool(thread,turn,'submit_result',{summary:'A 收到确认后完成代码。'});}
    this.emit('notification',{method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:'completed'}}});
  }catch(e){this.emit('notification',{method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:'failed',error:{message:String(e)}}}});}}
  respond(id:string,r:any){this.pending.get(id)?.(r);this.pending.delete(id);}
  reject(id:string,message:string){this.respond(id,{error:message});}
  close(){}
}
test('two isolated clients exchange actionable messages, commit and integrate real Git changes', {timeout:240000},async()=>{
  const relay=await relayFixture(),remote=join(relay.home,'remote.git'),seed=join(relay.home,'seed');await mkdir(seed);
  await git(relay.home,['init','--bare',remote]);await git(seed,['init','-b','main']);await git(seed,['config','user.name','Test']);await git(seed,['config','user.email','test@localhost']);await writeFile(join(seed,'README.md'),'test');await git(seed,['add','.']);await git(seed,['commit','-m','base']);await git(seed,['remote','add','origin',remote]);await git(seed,['push','-u','origin','main']);await git(remote,['symbolic-ref','HEAD','refs/heads/main']);
  const aPath=join(relay.home,'repo-a'),bPath=join(relay.home,'repo-b');await git(relay.home,['clone',remote,aPath]);await git(relay.home,['clone',remote,bPath]);
  for(const p of [aPath,bPath]){await git(p,['config','user.name','Test']);await git(p,['config','user.email','test@localhost']);}
  const sa=new ChatService(new ChatStore(join(relay.home,'client-a')),new FakeCodex() as unknown as AppServer),sb=new ChatService(new ChatStore(join(relay.home,'client-b')),new FakeCodex() as unknown as AppServer);
  try{
    await sa.configure(aPath,[[process.execPath,'-e','process.exit(0)']]);await sb.configure(bPath,[[process.execPath,'-e','process.exit(0)']]);const {invite}=await sa.pair(relay.url);await sb.pair(relay.url,invite);await until(()=>!!sa.snapshot().room?.peer&&!!sb.snapshot().room?.peer);sa.grant();sb.grant();
    const id=await sa.start('实现两个文件共同使用 interface:v1');
    try{await until(()=>sa.db.task(id).phase==='complete'&&sb.db.task(id).phase==='complete',120000);}catch(e){throw new Error(JSON.stringify({a:sa.snapshot(),b:sb.snapshot()},null,2));}
    const task=sa.db.task(id);assert.equal(Object.keys(task.results).length,2);assert.ok(task.integration);assert.equal(await readFile(join(task.path,'a.txt'),'utf8'),'interface:v1');assert.equal(await readFile(join(task.path,'b.txt'),'utf8'),'uses interface:v1');assert.equal(await git(aPath,['status','--porcelain']),'');assert.equal(await git(aPath,['branch','--show-current']),'main');assert.equal(task.reviewedSha,task.integration.sha);
    assert.ok(sa.db.list<any>('message').some(m=>m.role==='collaboration'&&m.text.includes('已确认')));
    // 上下文同步：两侧都收到对方增量进展，且注入后标记，不会在后续每轮重复占用上下文窗口。
    for(const [peer,who] of [[sa,'B'],[sb,'A']] as const){
      const bundles=peer.db.list<any>('peerctx').filter((b:any)=>b.task===id);
      assert.ok(bundles.length>=1,`${who} 侧没有收到任何同伴上下文`);
      assert.ok(bundles.length<=3,`${who} 侧收到 ${bundles.length} 份上下文，存在重复灌入风险`);
      assert.ok(bundles.some((b:any)=>b.entries.length>0),`${who} 侧收到的上下文为空`);
      for(const bundle of bundles)assert.ok(peer.db.get('ctxseen',`${id}:${bundle.id}`),`${who} 侧上下文读入后未标记，可能重复注入`);
    }
    assert.ok(sb.db.list<any>('message').some(m=>m.role==='context'),'未产生上下文同步记录');
    const prompts=(sb.server as unknown as FakeCodex).prompts;
    assert.ok(prompts.some(p=>p.includes('同伴上下文')),'同伴上下文没有进入本机 Codex 的提示词');
    assert.equal(prompts.filter(p=>p.includes('同伴上下文')).length,new Set(prompts.filter(p=>p.includes('同伴上下文'))).size,'同一份上下文不得被重复注入');
    const starts=(sa.server as unknown as FakeCodex).starts;sa.close();assert.ok(starts>=3);
  }finally{sa.close();sb.close();await sleep(100);sa.db.close();sb.db.close();await relay.close();}
});

test('context export keeps useful kinds, redacts secrets and merges repeated file state',()=>{
  const rows=[
    {item:{id:'1',type:'userMessage',text:'帮我加上排行榜',content:[]}},
    {item:{id:'2',type:'reasoning',text:'内部推理链不外发'}},
    {item:{id:'3',type:'agentMessage',text:'我先改 api.ts'}},
    // Synthetic marker for the redaction test, never an actual API credential.
    {item:{id:'4',type:'commandExecution',command:'npm test',aggregatedOutput:'key '+'sk-'+'proj-'+'A'.repeat(24)+' leaked',exitCode:0}},
    {item:{id:'5',type:'fileChange',changes:[{path:'src/api.ts',kind:'update'}]}},
    {item:{id:'6',type:'fileChange',changes:[{path:'src/api.ts',kind:'update'}]}},
    {item:{id:'7',type:'userMessage',text:'帮我加上排行榜',content:[]}},
  ];
  const entries=itemsToEntries(rows),text=JSON.stringify(entries);
  assert.ok(!text.includes('内部推理链不外发'),'推理链不应外发');
  assert.ok(text.includes('[REDACTED]'),'凭据必须被脱敏');
  assert.ok(!/sk-proj-AAAA/.test(text),'原始 token 不能出现在上下文里');
  assert.equal(entries.filter(e=>e.kind==='file').length,1,'同一文件应合并为一条最终状态');
  assert.equal(entries.filter(e=>e.kind==='user').length,1,'重复内容应去重');
  assert.equal(entries.find(e=>e.kind==='command')?.ok,true);
  assert.ok(text.includes('修改 src/api.ts'));
});

test('context bundle never exceeds the byte budget and always keeps the newest',()=>{
  const entries=Array.from({length:500},(_,i)=>({kind:'agent' as const,text:'x'.repeat(200)+i}));
  const bundle=buildBundle({task:randomUUID(),sender:randomUUID(),phase:'working',branch:'cm/x',entries,maxBytes:SYNC_BUDGET_AUTO});
  assert.ok(bundle.entries.length>0);
  assert.ok(Buffer.byteLength(JSON.stringify(bundle.entries),'utf8')<=SYNC_BUDGET_AUTO);
  assert.equal(bundle.entries[bundle.entries.length-1].text,'x'.repeat(200)+499,'预算裁剪必须保留最新进展');
  assert.equal(fit([{kind:'agent',text:'a'},{kind:'agent',text:'b'}],100).map(e=>e.text).join(''),'ab');
});

test('only rows after the last shared cursor are sent',()=>{
  const rows=['a','b','c'].map(id=>({item:{id}}));
  assert.equal(rowsAfter(rows,'b').rows.length,1);
  assert.equal(rowsAfter(rows,'b').anchored,true);
  assert.equal(rowsAfter(rows,'stale').rows.length,3,'锚点失效时退化为全量，由预算兜底');
  assert.equal(rowsAfter(rows,'stale').anchored,false);
  assert.equal(rowsAfter(rows,undefined).rows.length,3);
});

test('peer context rendering folds older entries and stays inside the prompt budget',()=>{
  const entries=Array.from({length:RECENT_KEEP+8},(_,i)=>({kind:'agent' as const,text:'第 '+i+' 步'}));
  const bundle=buildBundle({task:randomUUID(),sender:randomUUID(),phase:'working',branch:'cm/x',entries,maxBytes:1e6});
  const text=formatPeerContext(bundle);
  assert.ok(text.includes('另有 8 条更早进展'),'更早的进展应折叠为一行');
  assert.ok(text.includes('第 '+(RECENT_KEEP+7)+' 步'),'最新进展必须完整保留');
  assert.ok(text.length<=INJECT_BUDGET);
  const bulky=Array.from({length:20},(_,i)=>({kind:(i%2?'command':'agent') as any,text:'很长的上下文内容'.repeat(400)+i}));
  const rendered=formatPeerContext(buildBundle({task:randomUUID(),sender:randomUUID(),phase:'working',branch:'cm/x',entries:bulky,maxBytes:1e6}));
  assert.ok(rendered.length<=INJECT_BUDGET+4,'超出预算时必须压缩到可接受长度');
});

test('incoming context is accepted only as a validated plain structure',()=>{
  const base={id:randomUUID(),task:randomUUID(),sender:randomUUID(),phase:'working',branch:'cm/x',entries:[{kind:'agent',text:'hi'}]as any,at:Date.now()};
  assert.equal(contextBundleSchema.parse(base).entries.length,1);
  assert.throws(()=>contextBundleSchema.parse({...base,entries:[{kind:'__proto__',text:'x'}]}));
  assert.throws(()=>contextBundleSchema.parse({...base,entries:[{kind:'agent',text:'x'.repeat(5000)}]}),'超长条目必须被拒绝');
  assert.throws(()=>contextBundleSchema.parse({...base,task:'not-a-uuid'}));
});
