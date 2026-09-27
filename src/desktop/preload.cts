import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('desktop',{chooseRepository:()=>ipcRenderer.invoke('choose-repository'),openExternal:(url:string)=>ipcRenderer.invoke('open-external',url)});
