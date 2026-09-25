import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { serveChat } from '../chat/http.js';
let backend:Awaited<ReturnType<typeof serveChat>>|undefined;
if(!app.requestSingleInstanceLock())app.quit();
else void app.whenReady().then(async()=>{
  backend=await serveChat(process.env.CODEXMATE_HOME??app.getPath('userData'));
  const open=()=>{const win=new BrowserWindow({width:1160,height:820,minWidth:720,minHeight:540,title:'CodexMate',backgroundColor:'#fafafa',autoHideMenuBar:true,webPreferences:{preload:fileURLToPath(new URL('./preload.cjs',import.meta.url)),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.webContents.setWindowOpenHandler(({url})=>{if(safeExternal(url))void shell.openExternal(url);return {action:'deny'};});
    win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==backend!.url){event.preventDefault();if(safeExternal(url))void shell.openExternal(url);}});
    void win.loadURL(backend!.url);return win;
  };
  const safeSender=(event:Electron.IpcMainInvokeEvent)=>{if(!event.senderFrame||new URL(event.senderFrame.url).origin!==backend!.url)throw new Error('Invalid sender');};
  ipcMain.handle('choose-repository',async event=>{safeSender(event);const result=await dialog.showOpenDialog({title:'选择共享 Git 仓库',properties:['openDirectory']});return result.canceled?null:result.filePaths[0];});
  ipcMain.handle('open-external',async(event,url:string)=>{safeSender(event);if(!safeExternal(url))throw new Error('不允许打开此地址');await shell.openExternal(url);});
  open();app.on('activate',()=>{if(!BrowserWindow.getAllWindows().length)open();});app.on('second-instance',()=>{const w=BrowserWindow.getAllWindows()[0];w?.show();w?.focus();});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
  let closing=false;app.on('before-quit',e=>{if(backend&&!closing){e.preventDefault();closing=true;void backend.close().then(()=>app.quit());}});
}).catch(error=>{dialog.showErrorBox('CodexMate 启动失败',String(error));app.quit();});
function safeExternal(value:string){try{const u=new URL(value);return u.protocol==='https:'&&['auth.openai.com','chatgpt.com','auth0.openai.com','platform.openai.com'].includes(u.hostname);}catch{return false;}}
