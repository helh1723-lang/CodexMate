import {rm,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
// Only generated directories immediately inside this project may be removed.
for(const name of ['dist','web-dist']){
  const target=resolve(root,name);
  if(dirname(target)!==root)throw new Error('Build output escaped workspace');
  const stat=await lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(stat?.isSymbolicLink())throw new Error('Refusing to clean a linked build directory');
  await rm(target,{recursive:true,force:true});
}
for(const args of [['node_modules/typescript/bin/tsc','-p','tsconfig.build.json'],['node_modules/vite/bin/vite.js','build']]){
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('exit',resolve);});
  if(code!==0)process.exit(typeof code==='number'?code:1);
}
