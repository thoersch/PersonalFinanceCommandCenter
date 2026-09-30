import { contextBridge, ipcRenderer } from 'electron';

const api = {
  platform: process.platform,
  getConfig: (): Promise<{ apiUrl: string; token: string }> => ipcRenderer.invoke('config:get'),
  setConfig: (c: { apiUrl: string; token: string }) => ipcRenderer.invoke('config:set', c),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', { title, body }),
};

contextBridge.exposeInMainWorld('ff', api);
