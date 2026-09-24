import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store/index.js';
import { Service } from '../src/core/service.js';
import { seedDemo } from '../src/core/demo.js';
import { createApp } from '../src/server/index.js';
import { request } from 'node:http';
test('HTTP Host/Origin/本机 token 防护，以及异步审批持久化',async()=>{
  const s=new Service(new Store(mkdtempSync(join(tmpdir(),'cm-http-'))));seedDemo(s);
  const port=19437,web=await createApp(s,port),server=web.app.listen(port,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${port}`;
  try{
    assert.equal((await fetch(base+'/health')).status,200);
    assert.equal((await fetch(base+'/api/state')).status,401);
    assert.equal((await fetch(base+'/api/session',{headers:{Origin:'https://evil.example'}})).status,403);
    const wrongHost=await new Promise<number>(resolve=>{request(base+'/api/session',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode!);}).end();});
    assert.equal(wrongHost,403);
    const {token}=await (await fetch(base+'/api/session')).json() as any;
    const headers={'Content-Type':'application/json','X-CodexMate-Token':token};
    const res=await fetch(base+'/api/actions',{method:'POST',headers,body:JSON.stringify({repoId:'demo-studio',action:'run',target:'24'})});assert.equal(res.status,201);const a=await res.json() as any;assert.equal(s.snapshot().runs.length,0);
    const approve=await fetch(base+`/api/approvals/${a.id}`,{method:'POST',headers,body:JSON.stringify({approved:true})});assert.equal(approve.status,202);
    for(let i=0;i<20&&s.snapshot().runs.length===0;i++)await new Promise(r=>setTimeout(r,10));assert.equal(s.snapshot().runs.length,1);
    const exported=await (await fetch(base+'/api/export?anonymous=true',{headers})).text();assert(!exported.includes('studio/atlas'));assert(!exported.includes('threadId'));
  }finally{await web.close();await new Promise<void>((r,e)=>server.close(x=>x?e(x):r()));}
});
