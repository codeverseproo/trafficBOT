import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  store: {
    get:    (key: string)              => ipcRenderer.invoke('store-get', key),
    set:    (key: string, value: any)  => ipcRenderer.invoke('store-set', key, value),
    delete: (key: string)              => ipcRenderer.invoke('store-delete', key),
  },
  engine: {
    runProject:  (options: any) => ipcRenderer.invoke('run-project', options),
    stop:        ()             => ipcRenderer.invoke('stop-runner'),
    pause:       ()             => ipcRenderer.invoke('pause-runner'),
    resume:      ()             => ipcRenderer.invoke('resume-runner'),
  },
  onLog: (cb: (log: { level: string; msg: string; ts: number }) => void) => {
    ipcRenderer.on('runner-log', (_event, log) => cb(log));
    // Return cleanup fn
    return () => ipcRenderer.removeAllListeners('runner-log');
  },
});
