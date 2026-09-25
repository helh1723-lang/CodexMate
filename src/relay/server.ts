import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { Store } from '../store/index.js';
import { wireSchema, type Wire } from '../chat/model.js';
type Member={id:string;hash:string};
type RelayRoom={id:string;inviteHash:string;expires:number;members:Member[];active?:string;cancelled:string[]};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createRelay(home:string){
  const db=new Store(home),app=express(),http=createServer(app),wss=new WebSocketServer({server:http,maxPayload:128*1024});
  const sockets=new Map<string,WebSocket>();
  const limits=new Map<string,{count:number;until:number}>();
  app.disable('x-powered-by');app.use(express.json({limit:'8kb'}));
  app.use((req,res,next)=>{const key=req.socket.remoteAddress??'?';const now=Date.now();let v=limits.get(key);if(!v||v.until<now){v={count:0,until:now+60000};limits.set(key,v);}if(++v.count>60)return void res.status(429).json({error:'请求过于频繁'});next();});
  app.get('/health',(_req,res)=>res.json({ok:true,protocol:1}));
  app.post('/rooms',(_req,res)=>{
    const id=randomUUID(),member=randomUUID(),token=randomBytes(32).toString('hex'),invite=randomBytes(12).toString('hex');
    db.put<RelayRoom>('room',id,{id,inviteHash:hash(invite),expires:Date.now()+86400000,members:[{id:member,hash:hash(token)}],cancelled:[]});
    res.json({id,member,token,invite});
  });
  app.post('/join',(req,res)=>{
    const invite=typeof req.body.invite==='string'?req.body.invite:'';
    const room=db.list<RelayRoom>('room').find(r=>equal(r.inviteHash,hash(invite))&&r.expires>Date.now());
    if(!room||room.members.length!==1)return void res.status(400).json({error:'邀请码无效、已使用或已过期'});
    const member=randomUUID(),token=randomBytes(32).toString('hex');room.members.push({id:member,hash:hash(token)});room.expires=0;db.put('room',room.id,room);
    res.json({id:room.id,member,token});
  });
  const presence=(room:RelayRoom)=>{for(const m of room.members)sockets.get(m.id)?.send(JSON.stringify({type:'presence',members:room.members.map(p=>({id:p.id,online:sockets.get(p.id)?.readyState===WebSocket.OPEN}))}));};
  const sync=(ws:WebSocket,room:RelayRoom,member:string)=>{
    const pending=db.list<Wire>('event').filter(e=>e.room===room.id&&e.sender!==member&&!db.get('ack',`${member}:${e.id}`));
    // Cancellation tombstones always precede any replayed work, including after a long offline interval.
    ws.send(JSON.stringify({type:'batch',cancelled:room.cancelled,events:pending}));
  };
  wss.on('connection',ws=>{
    // ws emits error on oversized/malformed frames; without a listener one client can crash the relay.
    ws.on('error',()=>ws.terminate());
    let identity:{room:string;member:string}|undefined;let alive=true;
    const authTimer=setTimeout(()=>ws.close(1008,'authentication required'),5000);
    ws.on('pong',()=>{alive=true;});
    const heartbeat=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},15000);
    ws.on('message',raw=>{let data:any;try{
      data=JSON.parse(String(raw));
      if(!identity){
        if(data.type!=='auth'||typeof data.token!=='string')throw new Error('认证失败');
        const room=db.get<RelayRoom>('room',data.room);const member=room?.members.find(m=>m.id===data.member&&equal(m.hash,hash(data.token)));
        if(!room||!member)throw new Error('认证失败');
        identity={room:room.id,member:member.id};clearTimeout(authTimer);sockets.get(member.id)?.close(4001,'replaced');sockets.set(member.id,ws);
        ws.send(JSON.stringify({type:'ready'}));sync(ws,room,member.id);presence(room);return;
      }
      const room=db.get<RelayRoom>('room',identity.room)!;
      if(sockets.get(identity.member)!==ws)throw new Error('此连接已被新的本机连接替换');
      if(data.type==='ack'){if(typeof data.id!=='string')throw new Error('无效确认');const e=db.get<Wire>('event',data.id);if(e?.room===room.id&&e.sender!==identity.member)db.put('ack',`${identity.member}:${data.id}`,true);return;}
      if(data.type!=='event')throw new Error('未知消息');
      const event=wireSchema.parse(data.event);
      if(event.room!==room.id||event.sender!==identity.member)throw new Error('消息身份不符');
      const existing=db.get<Wire>('event',event.id);
      if(existing){if(JSON.stringify(existing)!==JSON.stringify(event))throw new Error('消息 ID 冲突');ws.send(JSON.stringify({type:'accepted',id:event.id}));return;}
      if(event.type==='start'&&room.active&&room.active!==event.task)throw new Error('房间已有活动任务');
      const task=db.get<{initiator:string;room:string;closed?:boolean;requirements?:string[]}>('task',event.task);
      if(event.type==='start'&&task)throw new Error('此任务 ID 已使用');
      if(event.type!=='start'&&(!task||task.room!==room.id))throw new Error('未知任务');
      if(event.type==='complete'&&task?.initiator!==event.sender)throw new Error('只有发起方可以结束任务');
      if(event.type==='complete'&&JSON.stringify([...(task?.requirements??[])].sort())!==JSON.stringify(Array.isArray(event.payload.requirements)?[...event.payload.requirements].sort():[]))throw new Error('任务有新的用户要求，旧审查不能结束任务');
      if(task?.closed&&event.type!=='cancel')throw new Error('任务已关闭');
      if(event.type!=='cancel'&&room.cancelled.includes(event.task))throw new Error('任务已取消');
      if(event.type!=='start'&&event.type!=='cancel'&&room.active!==event.task)throw new Error('任务已关闭或尚未创建');
      db.transaction(()=>{
        if(event.type==='start'){room.active=event.task;db.put('task',event.task,{initiator:event.sender,room:room.id});}
        if(event.type==='supplement')db.put('task',event.task,{...task,requirements:[...(task?.requirements??[]),event.id]});
        if(event.type==='cancel'){room.cancelled.push(event.task);if(room.active===event.task)room.active=undefined;}
        if(event.type==='complete'){room.active=undefined;db.put('task',event.task,{...task,closed:true});}
        db.put('room',room.id,room);db.put('event',event.id,event);
      });
      ws.send(JSON.stringify({type:'accepted',id:event.id}));
      for(const m of room.members)if(m.id!==identity.member){const peer=sockets.get(m.id);if(peer?.readyState===WebSocket.OPEN)sync(peer,room,m.id);}
    }catch(e){ws.send(JSON.stringify({type:'error',id:data?.event?.id,message:e instanceof Error?e.message:'协议错误'}));if(!identity)ws.close(1008);}});
    ws.on('close',()=>{clearTimeout(authTimer);clearInterval(heartbeat);if(identity&&sockets.get(identity.member)===ws){sockets.delete(identity.member);presence(db.get<RelayRoom>('room',identity.room)!);}});
  });
  return {app,http,db,close:()=>new Promise<void>(resolve=>{for(const ws of wss.clients)ws.terminate();wss.close();http.close(()=>{db.close();resolve();});})};
}
