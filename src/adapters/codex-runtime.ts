import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require=createRequire(import.meta.url);
export function codexExecutable(){
  const os=process.platform,arch=process.arch;
  const target=(arch==='arm64'?'aarch64':'x86_64')+(os==='win32'?'-pc-windows-msvc':os==='darwin'?'-apple-darwin':'-unknown-linux-musl');
  const name=`@openai/codex-${os==='win32'?'win32':os==='darwin'?'darwin':'linux'}-${arch}`;
  const codexRequire=createRequire(require.resolve('@openai/codex/package.json'));
  return join(dirname(codexRequire.resolve(name+'/package.json')),'vendor',target,'bin',os==='win32'?'codex.exe':'codex').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
}
