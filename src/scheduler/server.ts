import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../store/index.js';
import { LeaseStore } from './lease.js';
import { assert, AppError } from '../core/model.js';
const principalSchema=z.object({tokenSha256:z.string().regex(/^[a-f0-9]{64}$/),worker:z.string().min(1),repositories:z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).min(1)});
export const coordinatorConfigSchema=z.object({principals:z.array(principalSchema).min(1),leaseSeconds:z.number().int().min(30).max(300).default(90)});
const requestSchema=z.object({repo:z.string(),issue:z.number().int().positive(),revision:z.number().int().positive(),runId:z.string().uuid(),fence:z.number().int().positive().optional()});
export function coordinatorApp(store:Store,raw:unknown){const cfg=coordinatorConfigSchema.parse(raw),leases=new LeaseStore(store),app=express();app.disable('x-powered-by');app.use(express.json({limit:'8kb'}));app.get('/health',(_req,res)=>res.json({ok:true,mode:'experimental-coordinator'}));
  app.post('/v1/:action',(req,res,next)=>{try{const token=(req.get('Authorization')??'').replace(/^Bearer /,'');const hash=createHash('sha256').update(token).digest();const principal=cfg.principals.find(p=>timingSafeEqual(hash,Buffer.from(p.tokenSha256,'hex')));assert(principal,'COORDINATOR_AUTH','协调器身份无效。');const input=requestSchema.parse(req.body);assert(principal.repositories.includes(input.repo),'COORDINATOR_SCOPE','身份不允许操作该仓库。');const key=`${input.repo}:${input.issue}`,holder=`${principal.worker}:${input.revision}:${input.runId}`;let result:unknown;const action=String(req.params.action);if(action==='acquire')result=leases.acquire(key,holder,cfg.leaseSeconds*1000);else{assert(input.fence,'FENCE_REQUIRED','必须提供 fence token。');if(action==='renew')result=leases.renew(key,holder,input.fence,cfg.leaseSeconds*1000);else if(action==='validate')result=leases.validate(key,holder,input.fence);else if(action==='stop'){leases.stop(key,holder,input.fence);result={stopped:true};}else throw new AppError('ACTION','协调器动作不存在。');}store.audit(input.repo,`lease.${action}`,{worker:principal.worker,issue:input.issue,runId:input.runId,fence:input.fence});res.json(result);}catch(e){next(e);}});
  // 鉴权失败与越权访问必须与「租约冲突」区分开，否则运维无法判断是配置错误还是并发争抢。
  app.use((e:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(e instanceof z.ZodError?400:e?.code==='COORDINATOR_AUTH'?401:e?.code==='COORDINATOR_SCOPE'||e?.code==='FENCE_REQUIRED'?403:409).json({error:e.message}));return app;
}
