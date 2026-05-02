import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import Store from 'electron-store';
import { PlaywrightRunner } from '../src/engine/runner';

const store  = new Store();
let mainWindow: BrowserWindow | null = null;
const runner = new PlaywrightRunner(store);

// ─── Log streaming ────────────────────────────────────────────────────────────
// Intercept console.log/warn/error from the runner and forward to the renderer
const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);

function sendLog(level: 'info' | 'warn' | 'error', msg: string) {
  _origLog(`[${level.toUpperCase()}] ${msg}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('runner-log', { level, msg, ts: Date.now() });
  }
}

console.log   = (...args: any[]) => sendLog('info',  args.map(String).join(' '));
console.warn  = (...args: any[]) => sendLog('warn',  args.map(String).join(' '));
console.error = (...args: any[]) => sendLog('error', args.map(String).join(' '));

// ─── Window ───────────────────────────────────────────────────────────────────
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
};

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC: Store ───────────────────────────────────────────────────────────────
ipcMain.handle('store-get',    (_e, key)        => (store as any).get(key));
ipcMain.handle('store-set',    (_e, key, value) => (store as any).set(key, value));
ipcMain.handle('store-delete', (_e, key)        => (store as any).delete(key));

// ─── IPC: Runner ─────────────────────────────────────────────────────────────
ipcMain.handle('run-project', async (_e, options) => {
  try {
    await runner.start(options);
    return { success: true };
  } catch (error: any) {
    sendLog('error', `Run error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-runner',  () => { runner.gracefulStop(); return { ok: true }; });
ipcMain.handle('pause-runner', () => { runner.pause();        return { ok: true }; });
ipcMain.handle('resume-runner',() => { runner.resume();       return { ok: true }; });
