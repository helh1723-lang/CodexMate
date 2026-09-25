import { Store } from '../store/index.js';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, Task, Wire } from './model.js';
export class ChatStore extends Store {
  constructor(home:string){super(join(home,'chat'));}
  message(task:string,role:ChatMessage['role'],text:string,direction?:string,id:string=randomUUID()){
    return this.put<ChatMessage>('message',id,{id,task,role,text,at:Date.now(),direction});
  }
  task(id:string){const t=this.get<Task>('task',id);if(!t)throw new Error('会话不存在');return t;}
  save(task:Task){this.put('task',task.id,task);return task;}
  enqueue(event:Wire){this.put('outbox',event.id,event);return event;}
}
