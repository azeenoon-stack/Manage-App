const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const { createStorage } = require('./storage');

let storage;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 500,
    title: 'Планер',
    backgroundColor: '#fbfbfa',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // внешние ссылки открываем в обычном браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function registerIpc() {
  ipcMain.handle('data:load', () => storage.load());
  ipcMain.handle('data:save', (_e, data) => { storage.save(data); return true; });
  ipcMain.on('data:save-sync', (e, data) => {
    try { storage.save(data); e.returnValue = true; }
    catch (err) { console.error(err); e.returnValue = false; }
  });
}

app.whenReady().then(() => {
  storage = createStorage(app.getPath('userData'));
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
