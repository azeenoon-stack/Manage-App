// Хранение данных: data.json в папке userData, атомарная запись и ежедневные резервные копии.
const fs = require('fs');
const path = require('path');

const KEEP_BACKUPS = 14;

function createStorage(dir) {
  const dataFile = path.join(dir, 'data.json');
  const tmpFile = path.join(dir, 'data.json.tmp');
  const backupDir = path.join(dir, 'backups');

  const localDate = (d = new Date()) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  };

  // Атомарная запись: пишем во временный файл, сбрасываем на диск и переименовываем.
  function writeAtomic(text) {
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(tmpFile, 'w');
    try {
      fs.writeSync(fd, text, null, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpFile, dataFile);
  }

  function listBackups() {
    try {
      return fs.readdirSync(backupDir)
        .filter(f => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
        .reverse(); // самые свежие первыми
    } catch {
      return [];
    }
  }

  // Раз в день копируем data.json в backups/data-ГГГГ-ММ-ДД.json и оставляем последние 14.
  function backupIfNeeded() {
    if (!fs.existsSync(dataFile)) return;
    const target = path.join(backupDir, `data-${localDate()}.json`);
    if (fs.existsSync(target)) return;
    try {
      // копируем только корректный JSON, чтобы не сохранить в копию повреждённый файл
      JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      fs.mkdirSync(backupDir, { recursive: true });
      fs.copyFileSync(dataFile, target);
      for (const old of listBackups().slice(KEEP_BACKUPS)) {
        fs.rmSync(path.join(backupDir, old), { force: true });
      }
    } catch (e) {
      console.error('Не удалось создать резервную копию:', e);
    }
  }

  // Возвращает { data, status, message }.
  // status: 'ok' | 'new' (файла ещё нет) | 'restored' (восстановлено из копии) | 'corrupt' (восстановить не удалось)
  function load() {
    if (!fs.existsSync(dataFile)) return { data: null, status: 'new' };
    try {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      if (!data || !Array.isArray(data.pages)) throw new Error('Неверный формат');
      backupIfNeeded();
      return { data, status: 'ok' };
    } catch (e) {
      // Повреждённый файл не удаляем — откладываем в сторону, чтобы его можно было разобрать вручную.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const corruptName = `data.corrupt-${stamp}.json`;
      try { fs.renameSync(dataFile, path.join(dir, corruptName)); } catch {}
      for (const name of listBackups()) {
        try {
          const text = fs.readFileSync(path.join(backupDir, name), 'utf8');
          const data = JSON.parse(text);
          if (!data || !Array.isArray(data.pages)) continue;
          writeAtomic(text);
          return {
            data,
            status: 'restored',
            message: `Файл данных был повреждён. Данные восстановлены из резервной копии ${name}. Повреждённый файл сохранён как ${corruptName}.`,
          };
        } catch {}
      }
      return {
        data: null,
        status: 'corrupt',
        message: `Файл данных повреждён, а подходящей резервной копии нет. Повреждённый файл сохранён как ${corruptName}.`,
      };
    }
  }

  function save(data) {
    writeAtomic(JSON.stringify(data, null, 2));
    backupIfNeeded();
  }

  return { load, save, dataFile, backupDir };
}

module.exports = { createStorage };
