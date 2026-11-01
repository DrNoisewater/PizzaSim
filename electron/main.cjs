// Electron shell for the Windows (and macOS/Linux) desktop build.
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const savesDir = () => path.join(app.getPath('userData'), 'saves');
const slotPath = (slot) => {
  if (!/^[a-z0-9_-]{1,24}$/i.test(String(slot))) throw new Error('bad slot');
  return path.join(savesDir(), `${slot}.json`);
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#1d1714',
    title: 'Pizza SIM',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
}

ipcMain.handle('saves:list', async () => {
  await fs.mkdir(savesDir(), { recursive: true });
  const out = [];
  for (const f of await fs.readdir(savesDir())) {
    if (!f.endsWith('.json')) continue;
    try {
      const json = JSON.parse(await fs.readFile(path.join(savesDir(), f), 'utf8'));
      if (json && json.meta) out.push(json.meta);
    } catch {
      /* skip unreadable files */
    }
  }
  return out;
});
ipcMain.handle('saves:load', async (_e, slot) => {
  try {
    return JSON.parse(await fs.readFile(slotPath(slot), 'utf8'));
  } catch {
    return null;
  }
});
ipcMain.handle('saves:write', async (_e, file) => {
  await fs.mkdir(savesDir(), { recursive: true });
  const target = slotPath(file.meta.slot);
  const tmp = target + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(file));
  await fs.rename(tmp, target);
});
ipcMain.handle('saves:delete', async (_e, slot) => {
  await fs.rm(slotPath(slot), { force: true });
});
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('app:fullscreen', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.setFullScreen(!w.isFullScreen());
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
