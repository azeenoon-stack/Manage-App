// Мост между интерфейсом и главным процессом. Интерфейс не имеет доступа к Node.js,
// всё общение с файлами идёт только через эти функции.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  load: () => ipcRenderer.invoke('data:load'),
  // rev — номер версии данных, на которой основаны правки (нужен для синхронизации)
  save: (data, rev) => ipcRenderer.invoke('data:save', data, rev),
  // синхронное сохранение — для закрытия окна, чтобы ничего не потерять
  saveSync: (data, rev) => ipcRenderer.sendSync('data:save-sync', data, rev),
  // экспорт и импорт через системные диалоги
  exportData: text => ipcRenderer.invoke('data:export', text),
  importData: () => ipcRenderer.invoke('data:import'),
  // список напоминаний: [{ id, at, title, body, pageId }]
  setReminders: list => ipcRenderer.send('reminders:set', list),
  // команды из меню и уведомлений
  onCommand: fn => ipcRenderer.on('command', (_e, cmd, arg) => fn(cmd, arg)),
  // синхронизация: настройки, состояние связи и данные, пришедшие с сервера
  syncGet: () => ipcRenderer.invoke('sync:get'),
  syncSet: cfg => ipcRenderer.invoke('sync:set', cfg),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  onSyncStatus: fn => ipcRenderer.on('sync:status', (_e, st) => fn(st)),
  onRemote: fn => ipcRenderer.on('sync:remote', (_e, m) => fn(m)),
});
