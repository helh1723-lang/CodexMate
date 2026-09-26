import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveChat } from '../chat/http.js';
const configuredHome=process.env.CODEXMATE_HOME?resolve(process.env.CODEXMATE_HOME):undefined;
if(configuredHome)app.setPath('userData',configuredHome);
const smokeLogPath=process.env.CODEXMATE_SMOKE==='1'&&configuredHome?join(configuredHome,'desktop-smoke.log'):undefined;
const smokeLog=(message:string)=>{if(smokeLogPath)appendFileSync(smokeLogPath,`${message}\n`);};
let backend:Awaited<ReturnType<typeof serveChat>>|undefined;
if(!app.requestSingleInstanceLock())app.quit();
else void app.whenReady().then(async()=>{
  smokeLog('app-ready');
  backend=await serveChat(configuredHome??app.getPath('userData'));
  smokeLog(`server-ready url-valid=${URL.canParse(backend.url)}`);
  const open=()=>{const win=new BrowserWindow({width:1160,height:820,minWidth:720,minHeight:540,title:'CodexMate',backgroundColor:'#fafafa',autoHideMenuBar:true,webPreferences:{preload:fileURLToPath(new URL('./preload.cjs',import.meta.url)),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    smokeLog('window-created');
    const smokeDiagnostics=process.env.CODEXMATE_SMOKE==='1';
    if(smokeDiagnostics)win.webContents.on('did-start-navigation',(_event,url,_inPlace,isMainFrame)=>{const line=`did-start-navigation main=${isMainFrame} protocol=${new URL(url).protocol}`;smokeLog(line);console.error(`CodexMate ${line}`);});
    if(smokeDiagnostics)win.webContents.on('will-navigate',(_event,url)=>{const line=`will-navigate same-origin=${new URL(url).origin===backend!.url}`;smokeLog(line);console.error(`CodexMate ${line}`);});
    if(smokeDiagnostics)win.webContents.on('render-process-gone',(_event,details)=>{const line=`render-process-gone reason=${details.reason} exit-code=${details.exitCode}`;smokeLog(line);console.error(`CodexMate ${line}`);});
    if(smokeDiagnostics)win.webContents.on('did-fail-provisional-load',(_event,code,_description,_url,isMainFrame)=>{if(isMainFrame){const line=`did-fail-provisional-load code=${code}`;smokeLog(line);console.error(`CodexMate ${line}`);}});
    win.webContents.setWindowOpenHandler(({url})=>{if(safeExternal(url))void shell.openExternal(url);return {action:'deny'};});
    win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==backend!.url){event.preventDefault();if(safeExternal(url))void shell.openExternal(url);}});
    win.webContents.on('did-fail-load',(_event,code,description,_url,isMainFrame)=>{if(isMainFrame){smokeLog(`did-fail-load code=${code} description=${description}`);console.error(`CodexMate did-fail-load (${code}): ${description}`);}});
    const localUrl=backend?.url;
    if(!localUrl||!URL.canParse(localUrl)){smokeLog(`loadURL-invalid type=${typeof localUrl}`);console.error(`CodexMate loadURL rejected: invalid local URL (${typeof localUrl})`);}
    else {smokeLog('loadURL-called');void win.loadURL(localUrl).then(()=>smokeLog('loadURL-resolved')).catch(error=>{const code=error?.code??error?.name??'unknown';smokeLog(`loadURL-rejected code=${code}`);console.error(`CodexMate loadURL rejected (${code})`);});}
    return win;
  };
  const safeSender=(event:Electron.IpcMainInvokeEvent)=>{if(!event.senderFrame||new URL(event.senderFrame.url).origin!==backend!.url)throw new Error('Invalid sender');};
  ipcMain.handle('choose-repository',async event=>{safeSender(event);const result=await dialog.showOpenDialog({title:'选择共享 Git 仓库',properties:['openDirectory']});return result.canceled?null:result.filePaths[0];});
  ipcMain.handle('open-external',async(event,url:string)=>{safeSender(event);if(!safeExternal(url))throw new Error('不允许打开此地址');await shell.openExternal(url);});
  open();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)open();});app.on('second-instance',()=>{const w=BrowserWindow.getAllWindows()[0];w?.show();w?.focus();});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
  let closing=false;app.on('before-quit',e=>{if(backend&&!closing){e.preventDefault();closing=true;void backend.close().then(()=>app.quit());}});
}).catch(error=>{dialog.showErrorBox('CodexMate 启动失败',String(error));app.quit();});
function safeExternal(value:string){try{const u=new URL(value);return u.protocol==='https:'&&['auth.openai.com','chatgpt.com','auth0.openai.com','platform.openai.com'].includes(u.hostname);}catch{return false;}}
