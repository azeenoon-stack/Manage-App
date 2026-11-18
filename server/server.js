// Сервер синхронизации Планера.
// Хранит общую копию записей (страницы и задачи) и пересылает изменения всем подключённым
// приложениям по WebSocket. Логика слияния — та же, что в приложении (sync-core.js).
//
// Переменные окружения:
//   PLANER_TOKEN  — ключ доступа (обязательно, не короче 16 символов)
//   PORT          — порт (по умолчанию 8443)
//   DATA_DIR      — папка для данных (по умолчанию /data)
//   TLS_CERT, TLS_KEY — сертификат и ключ для HTTPS/WSS (без них — обычный HTTP/WS)
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const core = require('./sync-core');

const TOKEN = process.env.PLANER_TOKEN || '';
const PORT = Number(process.env.PORT) || 8443;
const DATA_DIR = process.env.DATA_DIR || '/data';
const { TLS_CERT, TLS_KEY } = process.env;
const STORE = path.join(DATA_DIR, 'store.json');
const BACKUPS = path.join(DATA_DIR, 'backups');
const KEEP_BACKUPS = 30;

if (TOKEN.length < 16) { console.error('PLANER_TOKEN не задан или слишком короткий'); process.exit(1); }

const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- хранилище ---------- */
const store = { recs: new Map(), dead: {} };
try {
  const s = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  for (const r of s.recs || []) store.recs.set(r.id, r);
  store.dead = s.dead || {};
  log(`Загружено записей: ${store.recs.size}`);
} catch (e) {
  if (e.code !== 'ENOENT') { console.error('Не удалось прочитать', STORE, e); process.exit(1); }
  log('Хранилище пустое');
}

let saveT = null;
function saveSoon() {
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 500);
}
function saveNow() {
  saveT = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify({ recs: [...store.recs.values()], dead: store.dead }));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, STORE);
  backupIfNeeded();
}
// раз в день — копия в backups/store-ГГГГ-ММ-ДД.json, храним последние 30
function backupIfNeeded() {
  const target = path.join(BACKUPS, `store-${new Date().toISOString().slice(0, 10)}.json`);
  if (fs.existsSync(target)) return;
  try {
    fs.mkdirSync(BACKUPS, { recursive: true });
    fs.copyFileSync(STORE, target);
    const old = fs.readdirSync(BACKUPS).filter(f => /^store-.*\.json$/.test(f)).sort().reverse().slice(KEEP_BACKUPS);
    for (const f of old) fs.rmSync(path.join(BACKUPS, f), { force: true });
  } catch (e) { console.error('Резервная копия не создана:', e); }
}

/* ---------- HTTPS с автоматическим обновлением сертификата ---------- */
let certStamp = '';
const readTls = () => ({ cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) });
const stampOf = () => [TLS_CERT, TLS_KEY].map(f => fs.statSync(f).mtimeMs).join('/');

const handler = (req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Планер: сервер синхронизации работает\n');
};
let server;
if (TLS_CERT && TLS_KEY) {
  server = https.createServer(readTls(), handler);
  certStamp = stampOf();
  // сертификат продлевается снаружи (acme.sh) — подхватываем новый без перезапуска
  setInterval(() => {
    try {
      const s = stampOf();
      if (s !== certStamp) { server.setSecureContext(readTls()); certStamp = s; log('Сертификат обновлён'); }
    } catch (e) { console.error('Не удалось обновить сертификат:', e.message); }
  }, 60 * 60 * 1000);
} else {
  server = http.createServer(handler);
}

/* ---------- WebSocket ---------- */
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const tokenOk = t => crypto.timingSafeEqual(hash(t), hash(TOKEN));

const wss = new WebSocketServer({ server, path: '/sync', maxPayload: 64 * 1024 * 1024 });

function broadcast(from, acc) {
  const msg = JSON.stringify({ t: 'put', recs: acc.recs, dead: acc.dead });
  for (const c of wss.clients) if (c !== from && c.authed && c.readyState === 1) c.send(msg);
}

function accept(ws, msg) {
  const acc = core.merge(store, msg);
  if (core.isEmpty(acc)) return;
  saveSoon();
  broadcast(ws, acc);
}

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  ws.authed = false;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  const authTimer = setTimeout(() => ws.terminate(), 10000);

  ws.on('message', raw => {
    ws.alive = true;
    let m;
    try { m = JSON.parse(raw); } catch { ws.close(1003); return; }
    if (!ws.authed) {
      if (!m || m.t !== 'hello' || !tokenOk(m.token)) {
        log('Неверный ключ, адрес', ip);
        clearTimeout(authTimer);
        // небольшая задержка — от перебора ключей
        setTimeout(() => {
          try { ws.send(JSON.stringify({ t: 'error', msg: 'Неверный ключ доступа' })); ws.close(4001); } catch {}
        }, 1500);
        return;
      }
      ws.authed = true;
      clearTimeout(authTimer);
      accept(ws, m);
      ws.send(JSON.stringify({ t: 'state', recs: [...store.recs.values()], dead: store.dead }));
      log(`Подключено приложение (${ip}), всего: ${[...wss.clients].filter(c => c.authed).length}`);
      return;
    }
    if (m.t === 'put') accept(ws, m);
    else if (m.t === 'ping') ws.send('{"t":"pong"}');
  });
  ws.on('close', () => clearTimeout(authTimer));
  ws.on('error', () => {});
});

// отключаем «зависшие» соединения
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => log(`Сервер синхронизации слушает порт ${PORT}${TLS_CERT ? ' (TLS)' : ''}`));

function shutdown() {
  if (saveT) { clearTimeout(saveT); saveNow(); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
