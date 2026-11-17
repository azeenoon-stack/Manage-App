// Мост между интерфейсом и главным процессом (пока пустой).
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('api', {});
