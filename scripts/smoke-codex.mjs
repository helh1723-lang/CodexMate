import {AppServer} from '../dist/chat/app-server.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const cwd=resolve('.local',`codex-smoke-${Date.now()}`);await mkdir(cwd,{recursive:true});
const server=new AppServer(),report={cwd,connected:false,loggedIn:false,thread:false,tool:false,completed:false,file:false,commands:[],approvalRequests:0};
let finish;const completed=new Promise(r=>finish=r);
server.on('request',m=>{if(m.method==='item/tool/call'){report.tool=true;server.respond(m.id,{success:true,contentItems:[{type:'inputText',text:'验证工具收到结果，请结束本轮。'}]});}else{report.approvalRequests++;server.reject(m.id,'Smoke test does not grant extra permissions');}});
server.on('notification',m=>{if(m.method==='item/completed'&&m.params.item?.type==='commandExecution')report.commands.push({command:m.params.item.command,exitCode:m.params.item.exitCode});if(m.method==='turn/completed'){report.completed=m.params.turn.status==='completed';report.status=m.params.turn.status;report.error=m.params.turn.error?.message;finish();}});
server.on('disconnected',message=>{report.disconnect=message;finish();});
let timer;
try{
  await server.start();report.connected=true;const account=await server.request('account/read',{refreshToken:false});report.loggedIn=!!account.account;if(!report.loggedIn)throw new Error('本机 Codex 尚未登录');
  const r=await server.request('thread/start',{cwd,runtimeWorkspaceRoots:[cwd],sandbox:'workspace-write',approvalPolicy:'on-request',config:{'sandbox_workspace_write.network_access':false},dynamicTools:[{type:'function',name:'smoke_result',description:'Call after writing and verifying the requested file.',inputSchema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}}]});report.thread=!!r.thread.id;
  const turn=await server.request('turn/start',{threadId:r.thread.id,input:[{type:'text',text:'This is a bounded local smoke test. In the current workspace only, create smoke.txt containing exactly CODEXMATE_OK. Execute a local command to read it and verify its contents. Call smoke_result with ok true after successful verification. Do not access other directories, network or git. Then finish briefly.',text_elements:[]}]});
  timer=setTimeout(()=>{report.timeout=true;void server.request('turn/interrupt',{threadId:r.thread.id,turnId:turn.turn.id}).finally(()=>finish());},120000);
  await completed;report.file=(await readFile(join(cwd,'smoke.txt'),'utf8').catch(()=>'' )).trim()==='CODEXMATE_OK';
  if(!report.completed||!report.file||!report.tool)process.exitCode=1;
}catch(e){report.error=e.message;process.exitCode=1;}finally{clearTimeout(timer);server.close();await mkdir('artifacts',{recursive:true});await writeFile('artifacts/codex-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
