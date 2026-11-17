# Планер (Manage App)

Десктопное приложение (Windows + macOS) для задач и заметок в духе Notion. Electron + чистый HTML/CSS/JS.

- Полное задание и этапы: **TASK.md**. Исходный прототип: `prototype/`.
- Общайся со мной по-русски. Интерфейс приложения на русском.
- Я на Windows: команды для PowerShell.
- Без фреймворков и CDN, всё работает офлайн.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, файлы только через preload + IPC.
- Данные: `data.json` в `app.getPath('userData')`, атомарная запись, резервные копии. Формат меняется только с миграцией (`version`).
- После каждого этапа: проверить, закоммитить, коротко отчитаться.
- Запуск: `npm start`. Сборка: `npm run build:win` / `npm run build:mac`.
