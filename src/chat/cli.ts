#!/usr/bin/env node
import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { serveChat } from './http.js';
import { createRelay } from '../relay/server.js';
const cli=new Command().name('codexmate').description('极简双 Agent 协作聊天').version('2.0.0-alpha.2');
cli.command('ui',{isDefault:true}).option('--home <path>','本机数据目录',process.env.CODEXMATE_HOME??join(homedir(),'.codexmate')).option('--port <port>','本机端口','4317').action(async o=>{const app=await serveChat(o.home,Number(o.port));console.log(`CodexMate: ${app.url}`);process.on('SIGINT',()=>void app.close().then(()=>process.exit()));process.on('SIGTERM',()=>void app.close().then(()=>process.exit()));});
cli.command('relay').option('--home <path>','持久数据目录',process.env.RELAY_HOME??join(homedir(),'.codexmate-relay')).option('--host <host>','监听地址','127.0.0.1').option('--port <port>','监听端口','8787').action(o=>{const relay=createRelay(o.home);relay.http.listen(Number(o.port),o.host,()=>console.log(`Relay: ${o.host}:${o.port}`));process.on('SIGINT',()=>void relay.close().then(()=>process.exit()));process.on('SIGTERM',()=>void relay.close().then(()=>process.exit()));});
await cli.parseAsync();
