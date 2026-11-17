// Мост между интерфейсом и главным процессом. Интерфейс не имеет доступа к Node.js,
// всё общение с файлами идёт только через эти функции.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  load: () => ipcRenderer.invoke('data:load'),
  save: data => ipcRenderer.invoke('data:save', data),
  // синхронное сохранение — для закрытия окна, чтобы ничего не потерять
  saveSync: data => ipcRenderer.sendSync('data:save-sync', data),
  // экспорт и импорт через системные диалоги
  exportData: text => ipcRenderer.invoke('data:export', text),
  importData: () => ipcRenderer.invoke('data:import'),
  // список напоминаний: [{ id, at, title, body, pageId }]
  setReminders: list => ipcRenderer.send('reminders:set', list),
  // команды из меню и уведомлений
  onCommand: fn => ipcRenderer.on('command', (_e, cmd, arg) => fn(cmd, arg)),
});
