import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openPath: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('open-path', filePath),
});
