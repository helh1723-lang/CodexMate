import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { ChatService } from './service.js';
import { ChatStore } from './store.js';
import { redact } from '../core/security.js';

export async function serveChat(home:string,port=0,service=new ChatService(new ChatStore(home))){
  const app=express(),http=createServer(app),token=randomBytes(32).toString('hex');let origin='';
  if(process.env.CODEXMATE_SMOKE==='1')http.on('request',(req,res)=>{const path=new URL(req.url??'/', 'http://127.0.0.1').pathname;appendFileSync(join(home,'desktop-smoke.log'),`http-request method=${req.method} path=${path}\n`);res.on('finish',()=>appendFileSync(join(home,'desktop-smoke.log'),`http-response status=${res.statusCode}\n`));});
  app.disable('x-powered-by');app.use((req,res,next)=>{
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin)return void res.status(403).json({error:'仅允许本机应用访问'});next();
  });
  app.get('/api/session',(_req,res)=>res.json({token}));
  app.use('/api',(req,res,next)=>{res.setHeader('Cache-Control','no-store');const supplied=String(req.headers['x-codexmate-token']??'');if(supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token)))return void res.status(403).json({error:'本机会话令牌无效'});next();});
  app.use(express.json({limit:'128kb'}));
  app.get('/api/state',(_req,res)=>res.json(service.snapshot()));
  app.get('/api/events',(req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});const update=()=>res.write('data: changed\n\n');service.on('change',update);const timer=setInterval(()=>res.write(': keepalive\n\n'),15000);req.on('close',()=>{clearInterval(timer);service.off('change',update);});update();});
  app.post('/api/action',async(req,res,next)=>{try{
    const {action,input}=z.object({action:z.string(),input:z.record(z.unknown()).default({})}).parse(req.body);let result:unknown;
    if(action==='account')result=await service.account();
    else if(action==='login')result=await service.login();
    else if(action==='project'){const p=z.object({path:z.string().min(1),checks:z.array(z.array(z.string().min(1)).min(1)).max(10)}).parse(input);result=await service.configure(p.path,p.checks);}
    else if(action==='pair'){const p=z.object({url:z.string(),invite:z.string().optional()}).parse(input);result=await service.pair(p.url,p.invite);}
    else if(action==='grant')result=service.grant();
    else if(action==='start')result=await service.start(z.string().min(1).max(20000).parse(input.text));
    else if(action==='supplement')result=await service.supplement(z.string().uuid().parse(input.id),z.string().min(1).max(20000).parse(input.text));
    else if(action==='stop')result=await service.stop(z.string().uuid().parse(input.id));
    else if(action==='resume')result=await service.resume(z.string().uuid().parse(input.id));
    else if(action==='decide')result=service.decide(z.string().uuid().parse(input.id),z.boolean().parse(input.allow),z.record(z.object({answers:z.array(z.string())})).optional().parse(input.answers));
    else if(action==='context')result=await service.syncContext(z.string().uuid().parse(input.id));
    else if(action==='diff')result=await service.diff(z.string().uuid().parse(input.id));
    else throw new Error('未知操作');res.json({result});
  }catch(e){next(e);}});
  app.use(express.static(resolve(fileURLToPath(new URL('../../web-dist',import.meta.url)))));
  // Source execution and compiled execution have different depths; keep one explicit fallback.
  app.use(express.static(resolve(fileURLToPath(new URL('../../../web-dist',import.meta.url)))));
  app.use((e:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(400).json({error:redact(e.message)}));
  await new Promise<void>(resolve=>http.listen(port,'127.0.0.1',resolve));const addr=http.address();if(!addr||typeof addr==='string')throw new Error('无法启动本机服务');origin=`http://127.0.0.1:${addr.port}`;
  return {url:origin,http,service,close:()=>new Promise<void>(resolve=>{service.close();http.closeAllConnections();http.close(()=>{service.db.close();resolve();});})};
}
