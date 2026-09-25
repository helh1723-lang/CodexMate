import { z } from 'zod';
export const wireSchema = z.object({
  id:z.string().uuid(), room:z.string().uuid(), task:z.string().uuid(), sender:z.string().uuid(),
  type:z.enum(['start','message','result','review','reviewed','complete','cancel','supplement','context']),
  correlation:z.string().uuid().optional(), payload:z.record(z.unknown()), at:z.number(),
});
export type Wire = z.infer<typeof wireSchema>;
export type Room = {url:string;id:string;member:string;token:string;invite?:string;peer?:string;online?:boolean};
export type Project = {path:string;remote:string;name:string;checks:string[][];grant?:{room:string;peer:string}};
export type Check = {command:string[];code:number;output:string};
export type Result = {sha:string;branch:string;summary:string;checks:Check[];requirements?:string[]};
export type Task = {id:string;title:string;goal:string;initiator:string;base:string;phase:'working'|'integrating'|'reviewing'|'paused'|'cancelled'|'complete';resumePhase?:'working'|'integrating'|'reviewing';path:string;branch:string;thread?:string;turn?:string;wakes:number;budget:number;repairs:number;results:Record<string,Result>;integration?:Result;reviewedSha?:string;pendingSubmit?:string;pendingReview?:{approved:boolean;summary:string};requirements?:string[];error?:string;created:number};
export type ChatMessage = {id:string;task:string;role:'user'|'assistant'|'system'|'collaboration'|'terminal'|'context';text:string;at:number;direction?:string};
export type Permission = {id:string;task:string;method:string;params:any};
export const textInput=(text:string)=>[{type:'text',text,text_elements:[]}];
