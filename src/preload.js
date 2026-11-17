// Мост между интерфейсом и главным процессом. Интерфейс не имеет доступа к Node.js,
// всё общение с файлами идёт только через эти функции.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: data => ipcRenderer.invoke('data:save', data),
  // синхронное сохранение — для закрытия окна, чтобы ничего не потерять
  saveSync: data => ipcRenderer.sendSync('data:save-sync', data),
});
