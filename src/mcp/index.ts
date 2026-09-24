import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { Service } from '../core/service.js';
import { redact } from '../core/security.js';
export async function serveMcp(service:Service){
  const server=new McpServer({name:'codexmate',version:'1.1.0-rc.1'});
  const result=(value:unknown)=>({content:[{type:'text' as const,text:redact(JSON.stringify(value))}]});
  server.tool('cm_status','读取已绑定仓库与本机状态，不访问未知仓库。',{},async()=>result(service.snapshot()));
  server.tool('cm_list_tasks','读取已同步的任务。',{repoId:z.string()},async({repoId})=>{service.project(repoId);return result(service.snapshot().tasks.filter(t=>t.repoId===repoId));});
  server.tool('cm_task_context','读取任务、验收、依赖与本机运行。',{repoId:z.string(),issue:z.number().int().positive()},async({repoId,issue})=>result({task:service.task(repoId,issue),run:service.latest(repoId,issue)}));
  const actions=[['cm_request_run','run'],['cm_request_review','review'],['cm_create_handoff','handoff'],['cm_accept_handoff','accept_handoff']] as const;
  for(const [name,action] of actions)server.tool(name,'仅创建审批请求；必须由用户在本机 CLI 或面板确认，MCP 无批准工具。',{repoId:z.string(),target:z.string(),to:z.string().optional()},async({repoId,target,to})=>result(service.request({repoId,target,action,input:to?{to}:{}})));
  await server.connect(new StdioServerTransport());return server;
}
