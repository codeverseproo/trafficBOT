"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('api', {
    store: {
        get: (key) => electron_1.ipcRenderer.invoke('store-get', key),
        set: (key, value) => electron_1.ipcRenderer.invoke('store-set', key, value),
        delete: (key) => electron_1.ipcRenderer.invoke('store-delete', key),
    },
    engine: {
        runProject: (options) => electron_1.ipcRenderer.invoke('run-project', options),
        stop: () => electron_1.ipcRenderer.invoke('stop-runner'),
        pause: () => electron_1.ipcRenderer.invoke('pause-runner'),
        resume: () => electron_1.ipcRenderer.invoke('resume-runner'),
    },
    onLog: (cb) => {
        electron_1.ipcRenderer.on('runner-log', (_event, log) => cb(log));
        // Return cleanup fn
        return () => electron_1.ipcRenderer.removeAllListeners('runner-log');
    },
});
