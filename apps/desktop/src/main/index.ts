import { app, BrowserWindow, ipcMain, Notification, safeStorage, shell } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface StoredConfig {
  apiUrl: string;
  tokenEnc?: string; // base64, encrypted with the OS keychain via safeStorage when available
  tokenPlain?: string; // fallback on Linux without a keyring
}

const configPath = () => join(app.getPath('userData'), 'config.json');

function readConfig(): StoredConfig {
  try {
    if (existsSync(configPath())) return JSON.parse(readFileSync(configPath(), 'utf8'));
  } catch {
    /* corrupted file — start fresh */
  }
  return { apiUrl: 'http://localhost:3000' };
}

function publicConfig() {
  const c = readConfig();
  let token = '';
  if (c.tokenEnc && safeStorage.isEncryptionAvailable()) {
    try {
      token = safeStorage.decryptString(Buffer.from(c.tokenEnc, 'base64'));
    } catch {
      token = '';
    }
  } else if (c.tokenPlain) token = c.tokenPlain;
  return { apiUrl: c.apiUrl, token };
}

function saveConfig(input: { apiUrl: string; token: string }) {
  const next: StoredConfig = { apiUrl: input.apiUrl.replace(/\/+$/, '') };
  if (input.token) {
    if (safeStorage.isEncryptionAvailable()) next.tokenEnc = safeStorage.encryptString(input.token).toString('base64');
    else next.tokenPlain = input.token;
  }
  writeFileSync(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return publicConfig();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0B0E13',
    title: 'Finance Finder',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, '../renderer/index.html'));
}

ipcMain.handle('config:get', () => publicConfig());
ipcMain.handle('config:set', (_e, input: { apiUrl: string; token: string }) => saveConfig(input));
ipcMain.handle('shell:open', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url);
});
ipcMain.handle('notify', (_e, n: { title: string; body: string }) => {
  if (Notification.isSupported()) new Notification({ title: n.title, body: n.body }).show();
});

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.financefinder.app');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
