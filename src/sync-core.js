// Общая логика синхронизации. Используется приложением (главный процесс) и сервером.
//
// Данные Планера (страницы с вложенными задачами) раскладываются на отдельные записи:
//   { id, k: 'p' | 't', upd, d }
// k — страница или задача, upd — время последнего изменения (мс), d — сами поля
// (у страницы без списка задач; у задачи добавлены pg — id страницы и o — позиция).
// Слияние «по записям»: из двух версий одной записи остаётся более поздняя, поэтому правки
// разных задач на разных компьютерах не мешают друг другу. Удаления запоминаются в dead
// ({ id: время удаления }), чтобы удалённая запись не «воскресала» при следующем обмене.
'use strict';

// Документ (как в data.json) → Map(id → запись без upd)
function toRecords(doc) {
  const out = new Map();
  (doc && Array.isArray(doc.pages) ? doc.pages : []).forEach((p, i) => {
    if (!p || !p.id) return;
    const { tasks, ...rest } = p;
    out.set(p.id, { id: p.id, k: 'p', d: { ...rest, o: i } });
    (Array.isArray(tasks) ? tasks : []).forEach((t, j) => {
      if (t && t.id) out.set(t.id, { id: t.id, k: 't', d: { ...t, pg: p.id, o: j } });
    });
  });
  return out;
}

const byOrder = (a, b) => (a.o - b.o) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Записи → документ. ui — остальные поля документа (тема, выбранная страница и т.п.)
function fromRecords(recs, ui) {
  const pages = [], tasks = [];
  for (const r of recs) (r.k === 'p' ? pages : tasks).push(r.d);
  pages.sort(byOrder);
  tasks.sort(byOrder);
  const byId = new Map();
  const outPages = pages.map(d => {
    const { o, ...p } = d;
    p.tasks = [];
    byId.set(p.id, p);
    return p;
  });
  for (const d of tasks) {
    const { o, pg, ...t } = d;
    // страницу задачи удалили на другом компьютере — не теряем задачу, кладём на первую страницу
    const p = byId.get(pg) || outPages[0];
    if (p) p.tasks.push(t);
  }
  return { ...ui, pages: outPages };
}

const validRec = r => r && typeof r.id === 'string' && r.id && (r.k === 'p' || r.k === 't') &&
  Number.isFinite(r.upd) && r.d && typeof r.d === 'object' && r.d.id === r.id;

// Какая из двух версий записи новее. При равном времени решаем по содержимому,
// чтобы все компьютеры выбрали одно и то же.
function newer(a, b) {
  if (a.upd !== b.upd) return a.upd > b.upd;
  return JSON.stringify(a.d) > JSON.stringify(b.d);
}

// Влить входящие изменения inc = { recs: [...], dead: {} } в store = { recs: Map, dead: {} }.
// Возвращает принятые изменения в том же виде (их нужно разослать остальным).
function merge(store, inc) {
  const acc = { recs: [], dead: {} };
  for (const [id, ts] of Object.entries((inc && inc.dead) || {})) {
    if (!Number.isFinite(ts) || ts <= (store.dead[id] || 0)) continue;
    store.dead[id] = ts;
    acc.dead[id] = ts;
    const cur = store.recs.get(id);
    if (cur && cur.upd <= ts) store.recs.delete(id);
  }
  for (const r of (inc && Array.isArray(inc.recs)) ? inc.recs : []) {
    if (!validRec(r)) continue;
    if (Object.hasOwn(store.dead, r.id) && store.dead[r.id] >= r.upd) continue; // удалена позже этой правки
    const cur = store.recs.get(r.id);
    if (cur && !newer(r, cur)) continue;
    store.recs.set(r.id, r);
    acc.recs.push(r);
  }
  return acc;
}

const isEmpty = acc => !acc.recs.length && !Object.keys(acc.dead).length;

// Адрес сервера в любом виде («1.2.3.4:8443», «https://…») → wss://…/sync
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^[a-z]+:\/\//i.test(s)) s = 'wss://' + s;
  const u = new URL(s.replace(/^http/i, 'ws'));
  if (u.protocol !== 'wss:' && u.protocol !== 'ws:') throw new Error('Неверный адрес сервера');
  if (u.pathname === '/' || !u.pathname) u.pathname = '/sync';
  return u.toString();
}

module.exports = { toRecords, fromRecords, merge, isEmpty, normalizeUrl };
