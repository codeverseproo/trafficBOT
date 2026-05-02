"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const electron_store_1 = __importDefault(require("electron-store"));
const runner_1 = require("../src/engine/runner");
const store = new electron_store_1.default();
let mainWindow = null;
const runner = new runner_1.PlaywrightRunner(store);
// ─── Log streaming ────────────────────────────────────────────────────────────
// Intercept console.log/warn/error from the runner and forward to the renderer
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);
function sendLog(level, msg) {
    _origLog(`[${level.toUpperCase()}] ${msg}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('runner-log', { level, msg, ts: Date.now() });
    }
}
console.log = (...args) => sendLog('info', args.map(String).join(' '));
console.warn = (...args) => sendLog('warn', args.map(String).join(' '));
console.error = (...args) => sendLog('error', args.map(String).join(' '));
// ─── Window ───────────────────────────────────────────────────────────────────
const createWindow = () => {
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 860,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    if (!electron_1.app.isPackaged) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }
};
electron_1.app.on('ready', createWindow);
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
// ─── IPC: Store ───────────────────────────────────────────────────────────────
electron_1.ipcMain.handle('store-get', (_e, key) => store.get(key));
electron_1.ipcMain.handle('store-set', (_e, key, value) => store.set(key, value));
electron_1.ipcMain.handle('store-delete', (_e, key) => store.delete(key));
// ─── IPC: Runner ─────────────────────────────────────────────────────────────
electron_1.ipcMain.handle('run-project', async (_e, options) => {
    try {
        await runner.start(options);
        return { success: true };
    }
    catch (error) {
        sendLog('error', `Run error: ${error.message}`);
        return { success: false, error: error.message };
    }
});
electron_1.ipcMain.handle('stop-runner', () => { runner.gracefulStop(); return { ok: true }; });
electron_1.ipcMain.handle('pause-runner', () => { runner.pause(); return { ok: true }; });
electron_1.ipcMain.handle('resume-runner', () => { runner.resume(); return { ok: true }; });
