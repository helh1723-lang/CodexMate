import type { Service } from '../core/service.js';
export type Snapshot = ReturnType<Service['snapshot']>;
let token='';
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  if(!token){const res=await fetch('/api/session');if(!res.ok)throw new Error('无法连接本机工作台。');token=(await res.json()).token;}
  const res=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json','X-CodexMate-Token':token,...options.headers}});
  const data=await res.json();if(!res.ok){if(res.status===401)token='';throw new Error(data.error??'操作失败，请重试。');}return data;
}
export async function downloadExport(anonymous=false){const data=await api<unknown>('/export?anonymous='+anonymous);const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='codexmate-export.json';a.click();URL.revokeObjectURL(url);}
