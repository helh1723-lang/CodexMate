import { z } from 'zod';
import { assert, now } from '../core/model.js';
import type { Store } from '../store/index.js';
import { redact, publicText, digest } from '../core/security.js';
// Declarative integrations deliberately cannot load JavaScript or spawn processes.
export const adapterSchema=z.object({schema:z.literal('codexmate.adapter/v1'),id:z.string().regex(/^[a-z0-9-]{1,40}$/),name:z.string().min(1).max(100),kind:z.enum(['ci','notification']),url:z.string().url(),method:z.enum(['GET','POST']),description:z.string().max(1000)}).strict();
export type Adapter=z.infer<typeof adapterSchema>;
export class Adapters {
  constructor(private store:Store){}
  register(input:unknown){const a=adapterSchema.parse(input),url=new URL(a.url);assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.search,'ADAPTER_URL','适配器必须使用 HTTPS 且不能在 URL 中包含认证或查询参数。');assert(a.kind==='notification'?a.method==='POST':a.method==='GET','ADAPTER_METHOD','CI 仅支持读取，通知仅支持显式授权的发送。');this.store.put('adapter',a.id,a);this.store.remove('adapter-grant',a.id);this.store.audit('','adapter.registered',{id:a.id,url:a.url});return a;}
  grant(id:string){const a=this.store.get<Adapter>('adapter',id);assert(a,'ADAPTER_MISSING','适配器不存在。');this.store.put('adapter-grant',id,{hash:digest(a),at:now()});this.store.audit('','adapter.granted',{id,method:a.method,url:a.url});}
  revoke(id:string){this.store.remove('adapter-grant',id);this.store.audit('','adapter.revoked',{id});}
  async invoke(id:string,payload?:{url:string;state:string}){const a=this.store.get<Adapter>('adapter',id),grant=this.store.get<{hash:string}>('adapter-grant',id);assert(a&&grant?.hash===digest(a),'ADAPTER_APPROVAL','适配器尚未获本机授权或配置已改变。');if(payload){const url=new URL(payload.url);assert(url.protocol==='https:'&&url.hostname==='github.com','NOTIFICATION_LINK','通知只包含 GitHub 链接和状态。');publicText(payload.state);assert(payload.state.length<=100,'NOTIFICATION_SIZE','状态摘要过长。');}assert(a.method==='GET'||payload,'NOTIFICATION_PAYLOAD','通知需要明确的链接与状态。');const r=await fetch(a.url,{method:a.method,redirect:'error',headers:{Accept:'application/json',...(a.method==='POST'?{'Content-Type':'application/json'}:{})},body:a.method==='POST'?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(15000)});assert(r.ok,'ADAPTER_FAILED',`适配器返回 HTTP ${r.status}`);const result=redact((await r.text()).slice(0,20000));this.store.audit('','adapter.invoked',{id,status:r.status});return result;}
}
