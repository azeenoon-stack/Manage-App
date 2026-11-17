// Главный процесс Electron: окно, меню, работа с файлами.
const { app, BrowserWindow, shell, ipcMain, Menu, dialog, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { createStorage } = require('./storage');

const isMac = process.platform === 'darwin';
let storage;
let win = null;

/* ---------- одна копия приложения ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ---------- размер и положение окна ---------- */
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  const def = { width: 1200, height: 800 };
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (!(s.width >= 400 && s.height >= 300)) return def;
    // проверяем, что окно попадает на один из подключённых мониторов
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
      const area = screen.getDisplayMatching({ x: s.x, y: s.y, width: s.width, height: s.height }).workArea;
      const visible = s.x < area.x + area.width - 50 && s.x + s.width > area.x + 50 &&
                      s.y < area.y + area.height - 50 && s.y + 30 > area.y;
      if (!visible) { delete s.x; delete s.y; }
    }
    return s;
  } catch {
    return def;
  }
}

function saveWindowState() {
  if (!win) return;
  try {
    const b = win.getNormalBounds();
    const s = { ...b, maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
    fs.writeFileSync(stateFile(), JSON.stringify(s));
  } catch (e) {
    console.error('Не удалось сохранить положение окна:', e);
  }
}

/* ---------- окно ---------- */
function createWindow() {
  const st = loadWindowState();
  win = new BrowserWindow({
    x: st.x,
    y: st.y,
    width: st.width,
    height: st.height,
    minWidth: 720,
    minHeight: 500,
    title: 'Планер',
    show: false,
    backgroundColor: '#fbfbfa',
    autoHideMenuBar: true,
    // на macOS — аккуратный заголовок со «светофором» поверх боковой панели
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    icon: isMac ? undefined : path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (st.maximized) win.maximize();
  if (st.fullscreen) win.setFullScreen(true);
  win.once('ready-to-show', () => win.show());

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // внешние ссылки открываем в обычном браузере, а не внутри приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });

  win.on('close', saveWindowState);
  win.on('closed', () => { win = null; });
}

// Отправить команду интерфейсу (из меню, уведомлений и т.п.)
function send(cmd, arg) {
  if (!win) { createWindow(); win.webContents.once('did-finish-load', () => send(cmd, arg)); return; }
  win.webContents.send('command', cmd, arg);
}

/* ---------- меню ---------- */
function showAbout() {
  dialog.showMessageBox(win, {
    type: 'info',
    title: 'О программе',
    message: `Планер ${app.getVersion()}`,
    detail: 'Простой планер задач и заметок.\nВсе данные хранятся локально на этом компьютере.\n\n' +
            `Папка данных: ${app.getPath('userData')}\n` +
            `Electron ${process.versions.electron}`,
    buttons: ['OK', 'Открыть папку данных'],
    noLink: true,
  }).then(r => { if (r.response === 1) shell.openPath(app.getPath('userData')); });
}

function buildMenu() {
  const template = [
    ...(isMac ? [{
      label: 'Планер',
      submenu: [
        { label: 'О программе', click: showAbout },
        { type: 'separator' },
        { role: 'services', label: 'Службы' },
        { type: 'separator' },
        { role: 'hide', label: 'Скрыть Планер' },
        { role: 'hideOthers', label: 'Скрыть остальные' },
        { role: 'unhide', label: 'Показать все' },
        { type: 'separator' },
        { role: 'quit', label: 'Завершить Планер' },
      ],
    }] : []),
    {
      label: 'Файл',
      submenu: [
        { label: 'Новая страница', accelerator: 'CmdOrCtrl+N', click: () => send('new-page') },
        { type: 'separator' },
        { label: 'Экспорт…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('export') },
        { label: 'Импорт…', accelerator: 'CmdOrCtrl+O', click: () => send('import') },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Закрыть окно' } : { role: 'quit', label: 'Выход' },
      ],
    },
    {
      // Без этого меню на macOS не работают Ctrl/⌘+C, ⌘+V и т.д.
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Сменить тему', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('toggle-theme') },
        { label: 'Боковая панель', accelerator: 'CmdOrCtrl+\\', click: () => send('toggle-sidebar') },
        { label: 'Быстрый поиск', accelerator: 'CmdOrCtrl+K', click: () => send('palette') },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Обычный масштаб' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полноэкранный режим' },
        ...(app.isPackaged ? [] : [
          { type: 'separator' },
          { role: 'reload', label: 'Перезагрузить' },
          { role: 'toggleDevTools', label: 'Инструменты разработчика' },
        ]),
      ],
    },
    ...(isMac ? [{
      label: 'Окно',
      submenu: [
        { role: 'minimize', label: 'Свернуть' },
        { role: 'zoom', label: 'Изменить масштаб окна' },
        { type: 'separator' },
        { role: 'front', label: 'Все окна — на передний план' },
      ],
    }] : []),
    {
      label: 'Справка',
      role: 'help',
      submenu: [{ label: 'О программе', click: showAbout }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- обмен с интерфейсом ---------- */
function localDate() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion() }));

  ipcMain.handle('data:load', () => storage.load());
  ipcMain.handle('data:save', (_e, data) => { storage.save(data); return true; });
  ipcMain.on('data:save-sync', (e, data) => {
    try { storage.save(data); e.returnValue = true; }
    catch (err) { console.error(err); e.returnValue = false; }
  });

  ipcMain.handle('data:export', async (_e, text) => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Экспорт данных',
      defaultPath: path.join(app.getPath('documents'), `planer-${localDate()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, text, 'utf8');
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('data:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Импорт данных',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    return { text: fs.readFileSync(r.filePaths[0], 'utf8') };
  });
}

/* ---------- запуск ---------- */
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('uz.planer.app');
  storage = createStorage(app.getPath('userData'));
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
