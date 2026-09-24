import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Service } from '../core/service.js';
import { AppError, assert } from '../core/model.js';
import { redact } from '../core/security.js';
const equal=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function createApp(service:Service,port:number,development=false){
  const app=express(),token=randomBytes(32).toString('hex');const origin=`http://127.0.0.1:${port}`;
  app.disable('x-powered-by');
  app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"});if(req.headers.host!==`127.0.0.1:${port}`)return res.status(403).json({error:'仅允许本机访问。'});if(req.headers.origin&&req.headers.origin!==origin)return res.status(403).json({error:'跨站请求已阻止。'});next();});
  app.use(express.json({limit:'256kb'}));
  app.get('/health',(_req,res)=>res.json({ok:true,version:'1.1.0-rc.1'}));
  app.get('/ready',(_req,res)=>{service.store.db.prepare('SELECT 1').get();res.json({ok:true});});
  // Token can only be read by same-origin JavaScript; cross-site reads fail SOP and Host checks prevent rebinding.
  app.get('/api/session',(_req,res)=>res.json({token}));
  app.use('/api',(req,res,next)=>{const supplied=req.get('X-CodexMate-Token')??'';if(!equal(supplied,token))return res.status(401).json({error:'本机会话已过期，请刷新页面。'});next();});
  app.get('/api/state',(_req,res)=>res.json(service.snapshot()));
  app.get('/api/doctor',async(_req,res)=>res.json(await service.doctor()));
  app.post('/api/projects',async(req,res)=>{const {root}=z.object({root:z.string().min(1)}).parse(req.body);res.json(await service.connect(root));});
  app.post('/api/projects/:id/sync',async(req,res)=>res.json(await service.sync(String(req.params.id))));
  app.put('/api/projects/:id/settings',(req,res)=>res.json(service.settings(String(req.params.id),req.body)));
  app.post('/api/actions',(req,res)=>res.status(201).json(service.request(req.body)));
  const jobs=new Set<Promise<unknown>>();
  app.post('/api/approvals/:id',async(req,res)=>{
    const {approved}=z.object({approved:z.boolean()}).parse(req.body),id=String(req.params.id);
    const a=service.store.get<any>('approval',id);assert(a&&a.status==='pending','APPROVAL_STATE','审批不存在或已处理。');
    if(!approved){res.json(await service.approve(id,false));return;}
    // Long-running worker requests do not block HTTP. The durable approval carries success/failure.
    const job=service.approve(id,true).catch(e=>service.store.audit(a.repoId,'job.failed',String(e))).finally(()=>jobs.delete(job));jobs.add(job);res.status(202).json({id,status:'executing'});
  });
  app.get('/api/runs/:id/logs',async(req,res)=>res.json({text:await service.logs(String(req.params.id))}));
  app.get('/api/export',(req,res)=>{const anonymous=req.query.anonymous==='true';let data=JSON.stringify({exportedAt:new Date().toISOString(),...service.snapshot()});if(anonymous){for(const p of service.store.list<any>('project')){data=data.split(p.root).join('[local-path]').split(p.slug).join('[repository]');for(const m of p.members)data=data.split(m.login).join('[member]');}}res.setHeader('Content-Disposition','attachment; filename="codexmate-export.json"');res.type('json').send(redact(data));});
  app.post('/api/maintenance/prune',async(_req,res)=>res.json(await service.prune()));
  app.post('/api/maintenance/recover',async(_req,res)=>res.json(await service.recover()));
  app.delete('/api/notifications/:id',(req,res)=>{service.store.remove('notification',String(req.params.id));res.json({ok:true});});
  app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在。'}));
  const root=join(dirname(fileURLToPath(import.meta.url)),'../../web-dist');
  let vite:any;
  if(development&&!existsSync(join(root,'index.html'))){const {createServer}=await import('vite');vite=await createServer({configFile:join(process.cwd(),'vite.config.ts'),server:{middlewareMode:true,hmr:false}});app.use(vite.middlewares);}
  else{app.use(express.static(root));app.get('/{*path}',(_req,res)=>res.sendFile(join(root,'index.html')));}
  app.use((error:any,req:express.Request,res:express.Response,_next:express.NextFunction)=>{const id=randomBytes(6).toString('hex');service.store.audit('','http.error',{id,path:req.path,message:String(error)});res.status(error instanceof AppError?error.status:error instanceof z.ZodError?400:500).json({error:redact(error instanceof z.ZodError?'输入格式不正确。':error.message??'操作失败。'),code:error.code??'INTERNAL',requestId:id});});
  return {app,close:async()=>{for(const c of service.controllers.values())c.abort();await Promise.allSettled(jobs);if(vite)await vite.close();}};
}
