// Синхронизация с собственным сервером (главный процесс).
//
// Все сохранения проходят через этот модуль: он раскладывает данные на записи (sync-core.js),
// помечает изменённые записи временем, пишет data.json и, если синхронизация включена,
// отправляет изменения на сервер по WebSocket. Изменения с сервера вливаются сюда же
// и отправляются в интерфейс.
//
// Интерфейс присылает данные вместе с номером версии (rev), которую он видел последней.
// Изменения считаются относительно именно этой версии — так правки, пришедшие с сервера,
// пока интерфейс сохранял свои, не затираются.
//
// Файлы в папке userData:
//   sync.json        — адрес сервера, ключ, включена ли синхронизация
//   sync-state.json  — время изменения каждой записи и список удалённых
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('./sync-core');

const PING_MS = 25000;   // проверка связи
const DEAD_MS = 70000;   // нет ответа дольше — переподключаемся

function writeJsonAtomic(file, obj, mode) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeSync(fd, JSON.stringify(obj), null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function createSync({ dir, storage, onRemote, onStatus }) {
  const cfgFile = path.join(dir, 'sync.json');
  const stateFile = path.join(dir, 'sync-state.json');

  const store = { recs: new Map(), dead: {} };
  let ui = {};                 // поля документа кроме страниц: версия, тема, выбранная страница…
  let loaded = null;           // результат первой загрузки с диска
  let rev = 0;                 // номер версии данных, которую видел интерфейс
  const snaps = new Map();     // rev → Map(id → JSON полей) — снимки, относительно которых считаем правки

  let cfg = { url: '', token: '', enabled: false, ...(readJson(cfgFile) || {}) };
  let status = { state: 'off', msg: '', at: 0 };
  let ws = null, retryT = null, pingT = null, retry = 0, lastMsg = 0, stopped = false;

  /* ---------- данные ---------- */
  const jsonMap = () => new Map([...store.recs].map(([id, r]) => [id, JSON.stringify(r.d)]));
  const buildDoc = () => core.fromRecords(store.recs.values(), ui);

  function snapshot() {
    rev += 1;
    snaps.set(rev, jsonMap());
    return rev;
  }

  function persist() {
    storage.save(buildDoc());
    const upd = {};
    for (const [id, r] of store.recs) upd[id] = r.upd;
    try { writeJsonAtomic(stateFile, { upd, dead: store.dead }); }
    catch (e) { console.error('Не удалось сохранить состояние синхронизации:', e); }
  }

  function load() {
    if (!loaded) {
      loaded = storage.load();
      if (loaded.data) {
        const { pages, ...rest } = loaded.data;
        ui = rest;
        const st = readJson(stateFile) || {};
        const upd = st.upd || {};
        for (const [id, r] of core.toRecords(loaded.data)) {
          r.upd = Number.isFinite(upd[id]) ? upd[id] : 0;
          store.recs.set(id, r);
        }
        store.dead = st.dead && typeof st.dead === 'object' ? st.dead : {};
      }
      connect();
    }
    snaps.clear();
    const r = snapshot();
    // при повторном открытии окна (macOS) отдаём актуальные данные из памяти
    const data = loaded.data || store.recs.size ? buildDoc() : null;
    return { data, status: loaded.status, message: loaded.message, rev: r };
  }

  // Интерфейс прислал свои данные. baseRev — версия, на которой основаны его правки.
  function save(doc, baseRev) {
    const base = snaps.get(baseRev) || snaps.get(rev) || new Map();
    const now = core.toRecords(doc);
    const ch = { recs: [], dead: {} };
    const t = Date.now();
    for (const [id, r] of now) {
      const j = JSON.stringify(r.d);
      if (base.get(id) === j) continue;               // интерфейс эту запись не трогал
      const cur = store.recs.get(id);
      if (cur && JSON.stringify(cur.d) === j) continue;
      r.upd = Math.max(t, cur ? cur.upd + 1 : 0);
      ch.recs.push(r);
    }
    for (const id of base.keys()) {
      const cur = store.recs.get(id);
      if (!now.has(id) && cur) ch.dead[id] = Math.max(t, cur.upd + 1);
    }
    const { pages, ...rest } = doc;
    ui = rest;
    const acc = core.merge(store, ch);
    for (const k of [...snaps.keys()]) if (k < baseRev) snaps.delete(k);
    persist();
    if (!core.isEmpty(acc)) push(acc);
    // интерфейс сохранял поверх устаревшей версии — отдаём ему итог слияния
    if (baseRev !== rev) onRemote({ rev: snapshot(), data: buildDoc() });
  }

  // Изменения с сервера
  function applyIncoming(msg) {
    const acc = core.merge(store, msg);
    if (core.isEmpty(acc)) return;
    persist();
    onRemote({ rev: snapshot(), data: buildDoc() });
  }

  // Первое подключение второго компьютера: берём данные сервера вместо своих.
  // Если на сервере пусто — ничего не стираем, а отдаём серверу свои данные.
  function replaceWith(msg, sock) {
    cfg.replace = false;
    writeJsonAtomic(cfgFile, cfg, 0o600);
    const recs = Array.isArray(msg.recs) ? msg.recs : [];
    if (!recs.length) {
      sendMsg({ t: 'put', recs: [...store.recs.values()], dead: store.dead });
      return;
    }
    store.recs = new Map();
    store.dead = {};
    core.merge(store, msg);
    persist();
    onRemote({ rev: snapshot(), data: buildDoc() });
  }

  /* ---------- связь с сервером ---------- */
  function setStatus(state, msg = '') {
    status = { state, msg, at: state === 'online' ? Date.now() : status.at };
    onStatus(status);
  }

  function sendMsg(m) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(m));
  }

  function push(acc) {
    // без связи ничего не отправляем: при подключении приложение отдаёт серверу все записи
    if (!ws || ws.readyState !== 1) return;
    sendMsg({ t: 'put', recs: acc.recs, dead: acc.dead });
    if (status.state === 'online') { status.at = Date.now(); onStatus(status); }
  }

  function disconnect() {
    clearTimeout(retryT); clearInterval(pingT);
    if (ws) { const s = ws; ws = null; try { s.close(); } catch {} }
  }

  function scheduleReconnect() {
    clearTimeout(retryT);
    const delay = Math.min(60000, 1000 * 2 ** Math.min(retry, 6));
    retry += 1;
    retryT = setTimeout(connect, delay);
  }

  function connect() {
    disconnect();
    if (stopped) return;
    if (!cfg.enabled || !cfg.url || !cfg.token) { setStatus('off'); return; }
    let url;
    try { url = core.normalizeUrl(cfg.url); } catch { setStatus('error', 'Неверный адрес сервера'); return; }
    setStatus('connecting');
    let sock;
    try { sock = new WebSocket(url); } catch (e) { setStatus('error', 'Неверный адрес сервера'); return; }
    ws = sock;
    let authFailed = false;
    sock.onopen = () => {
      lastMsg = Date.now();
      // «заменить данными с сервера» — свои записи не отправляем, сначала получим серверные
      const mine = cfg.replace ? { recs: [], dead: {} } : { recs: [...store.recs.values()], dead: store.dead };
      sendMsg({ t: 'hello', token: cfg.token, ...mine });
      pingT = setInterval(() => {
        if (Date.now() - lastMsg > DEAD_MS) { try { sock.close(); } catch {} return; }
        sendMsg({ t: 'ping' });
      }, PING_MS);
    };
    sock.onmessage = ev => {
      if (ws !== sock) return;
      lastMsg = Date.now();
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'state') {
        retry = 0;
        if (cfg.replace) replaceWith(m, sock);
        else applyIncoming(m);
        setStatus('online');
      }
      else if (m.t === 'put') { applyIncoming(m); status.at = Date.now(); onStatus(status); }
      else if (m.t === 'error') { authFailed = true; setStatus('error', m.msg || 'Сервер отклонил подключение'); }
    };
    sock.onerror = () => {};
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      clearInterval(pingT);
      if (authFailed) return; // неверный ключ — не долбим сервер, ждём новых настроек
      setStatus('offline', 'Нет связи с сервером, повторим попытку');
      scheduleReconnect();
    };
  }

  /* ---------- настройки ---------- */
  function getConfig() {
    return { url: cfg.url, hasToken: !!cfg.token, enabled: cfg.enabled, status };
  }

  function setConfig({ url, token, enabled, replace }) {
    cfg.replace = !!replace && !!enabled;
    if (url !== undefined) {
      const u = String(url).trim();
      if (u) core.normalizeUrl(u); // бросит ошибку, если адрес неверный
      cfg.url = u;
    }
    if (token) cfg.token = String(token).trim();
    if (enabled !== undefined) cfg.enabled = !!enabled;
    writeJsonAtomic(cfgFile, cfg, 0o600);
    retry = 0;
    connect();
    return getConfig();
  }

  // При выходе из приложения
  function stop() { stopped = true; disconnect(); }

  // Сразу после подключения или по кнопке «Синхронизировать сейчас»
  function reconnect() { retry = 0; connect(); }

  return { load, save, getConfig, setConfig, stop, reconnect, status: () => status };
}

module.exports = { createSync };
