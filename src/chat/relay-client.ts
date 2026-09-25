import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import type { ChatStore } from './store.js';
import { wireSchema, type Room, type Wire } from './model.js';
export function relayUrl(value:string){
  const u=new URL(value);if(u.username||u.password||u.search||u.hash)throw new Error('中转地址不能包含凭据或查询参数');
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw new Error('远程中转必须使用 HTTPS，本机测试可使用 HTTP');
  return u.href.replace(/\/$/,'');
}
export class RelayClient extends EventEmitter {
  private ws?:WebSocket;private timer?:NodeJS.Timeout;private stopped=false;private ready=false;private retry=1000;
  constructor(private db:ChatStore,public room:Room){super();}
  connect(){
    this.stopped=false;const ws=this.ws=new WebSocket(this.room.url.replace(/^http/,'ws'));this.ready=false;
    ws.on('open',()=>ws.send(JSON.stringify({type:'auth',room:this.room.id,member:this.room.member,token:this.room.token})));
    ws.on('message',raw=>{if(this.stopped||this.ws!==ws)return;try{const m=JSON.parse(String(raw));
      if(m.type==='ready'){this.ready=true;this.retry=1000;/* wait for replay before flushing offline work */}
      if(m.type==='batch'){
        this.db.transaction(()=>{for(const id of m.cancelled??[])if(typeof id==='string')this.db.put('cancel',id,true);for(const value of m.events??[]){const e=wireSchema.parse(value);if(e.room!==this.room.id||e.sender===this.room.member)throw new Error('中转返回错误身份');if(!this.db.get('received',e.id)){this.db.put('inbox',e.id,e);this.db.put('received',e.id,true);}}});
        for(const e of m.events??[])ws.send(JSON.stringify({type:'ack',id:e.id}));
        this.emit('inbox');this.flush();
      }
      if(m.type==='accepted'){this.db.remove('outbox',m.id);this.emit('delivered',m.id);}
      if(m.type==='presence'){const peer=m.members.find((v:any)=>v.id!==this.room.member);this.room.peer=peer?.id;this.room.online=!!peer?.online;this.emit('presence',this.room);}
      if(m.type==='error'){if(m.id){const e=this.db.get<Wire>('outbox',m.id);if(e){this.db.put('rejected',m.id,{event:e,error:m.message});this.db.remove('outbox',m.id);}this.emit('rejected',m.id,m.message);}this.emit('problem',m.message);}
    }catch(e){this.emit('problem',String(e));}});
    ws.on('error',e=>this.emit('problem',e.message));
    ws.on('close',code=>{if(this.ws!==ws)return;this.ready=false;this.room.online=false;this.emit('presence',this.room);if(code===4001){this.stopped=true;this.emit('problem','此成员已在另一进程连接，请关闭重复客户端后重新启动。');}if(!this.stopped){this.timer=setTimeout(()=>this.connect(),this.retry);this.retry=Math.min(this.retry*2,30000);}});
  }
  flush(){if(!this.ready||this.ws?.readyState!==WebSocket.OPEN)return;for(const e of this.db.list<Wire>('outbox')){if(e.room!==this.room.id)continue;if(e.type!=='cancel'&&this.db.get('cancel',e.task)){this.db.remove('outbox',e.id);continue;}this.ws.send(JSON.stringify({type:'event',event:e}));}}
  async accepted(id:string){if(!this.db.get('outbox',id)){const failure=this.db.get<any>('rejected',id);if(failure)throw new Error(failure.error);return;}
    await new Promise<void>((resolve,reject)=>{const done=(value:string)=>{if(value===id){cleanup();resolve();}},failed=(value:string,error:string)=>{if(value===id){cleanup();reject(new Error(error));}},timer=setTimeout(()=>{cleanup();reject(new Error('中转尚未确认任务，已保存等待对账'));},15000);const cleanup=()=>{clearTimeout(timer);this.off('delivered',done);this.off('rejected',failed);};this.on('delivered',done);this.on('rejected',failed);});
  }
  close(){this.stopped=true;clearTimeout(this.timer);this.ws?.close();}
}
