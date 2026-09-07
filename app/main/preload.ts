import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  trpc: {
    query: (path: string, input?: unknown, token?: string | null) =>
      ipcRenderer.invoke('trpc:query', { path, input, token }),
    mutate: (path: string, input?: unknown, token?: string | null) =>
      ipcRenderer.invoke('trpc:mutate', { path, input, token }),
  },

  onUpdateAvailable: (callback: (info: { version: string; releaseDate: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: { version: string; releaseDate: string }) => callback(info);
    ipcRenderer.on('update:available', listener);
    return () => ipcRenderer.removeListener('update:available', listener);
  },
  onUpdateNotAvailable: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('update:not-available', listener);
    return () => ipcRenderer.removeListener('update:not-available', listener);
  },
  onUpdateError: (callback: (error: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on('update:error', listener);
    return () => ipcRenderer.removeListener('update:error', listener);
  },
  onUpdateProgress: (callback: (progress: { percent: number; bytesPerSecond: number; total: number; transferred: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { percent: number; bytesPerSecond: number; total: number; transferred: number }) => callback(progress);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },
  onUpdateDownloaded: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('update:downloaded', listener);
    return () => ipcRenderer.removeListener('update:downloaded', listener);
  },
  onCashSessionClosed: (callback: (info: { sessionIds: number[] }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: { sessionIds: number[] }) => callback(info);
    ipcRenderer.on('cash:session-closed', listener);
    return () => ipcRenderer.removeListener('cash:session-closed', listener);
  },
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  openFile: (filePath: string) => ipcRenderer.invoke('file:open', filePath),
  showNotification: (title: string, body: string) => ipcRenderer.invoke('notification:show', { title, body }),
});
