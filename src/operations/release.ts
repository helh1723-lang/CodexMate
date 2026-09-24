import { createHash, verify, sign, createPublicKey, KeyObject } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { assert } from '../core/model.js';
const manifestSchema=z.object({schema:z.literal('codexmate.release/v1'),version:z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/),file:z.string().regex(/^[\w.-]+\.tgz$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().positive(),signature:z.string()});
export type ReleaseManifest=z.infer<typeof manifestSchema>;
export function signedPayload(m:Omit<ReleaseManifest,'signature'>){return Buffer.from(JSON.stringify({schema:m.schema,version:m.version,file:m.file,sha256:m.sha256,size:m.size}));}
export async function signRelease(file:string,version:string,key:string|KeyObject):Promise<ReleaseManifest>{const bytes=await readFile(file),m={schema:'codexmate.release/v1' as const,version,file:basename(file),sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};return {...m,signature:sign(null,signedPayload(m),key).toString('base64')};}
export async function verifyRelease(file:string,manifest:unknown,publicKey:string|KeyObject){const m=manifestSchema.parse(manifest),bytes=await readFile(file);assert(bytes.length===m.size&&createHash('sha256').update(bytes).digest('hex')===m.sha256,'UPDATE_HASH','更新包校验不一致，拒绝安装。');assert(verify(null,signedPayload(m),publicKey,Buffer.from(m.signature,'base64')),'UPDATE_SIGNATURE','更新签名无效，拒绝安装。');return m;}
export async function stageRelease(file:string,manifest:unknown,publicKey:string|KeyObject,home:string){const m=await verifyRelease(file,manifest,publicKey);const dir=join(home,'updates',m.version);await mkdir(dir,{recursive:true});const destination=join(dir,m.file);await copyFile(file,destination);await writeFile(join(dir,'manifest.json'),JSON.stringify(m,null,2));return {version:m.version,package:destination,next:'停止 Worker 和 UI，备份 SQLite 后运行 npm install -g <已验证包路径>。旧包保留可回滚。'};}
