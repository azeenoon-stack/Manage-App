'use strict';
/* Планер — интерфейс. Чистый JS без фреймворков.
   Всё состояние лежит в объекте S, после любого изменения вызываем save() и нужный render. */

const KEY = 'planer-v1'; // ключ localStorage из прототипа (только для переноса данных)
const DATA_VERSION = 2;
const EMOJI = ['📄','🏠','💼','📌','🎯','✅','📚','💡','🛒','✈️','🏋️','🎨','💰','🧠','📅','🔥','⭐','🌱','🎵','🍳','🧩','🚀','❤️','📝'];
const STAT = {todo:'Сделать', doing:'В работе', done:'Готово'};
const PR = {1:'● Высокий', 2:'● Средний', 3:'● Низкий'};
const REMIND = {'':'Без напоминания', '0':'В момент срока', '5':'За 5 минут', '15':'За 15 минут', '60':'За 1 час', '1440':'За 1 день'};
const DEFAULT_TIME = '09:00'; // время напоминания, если у задачи указан только день
const UNTITLED = 'Без названия';

/* ---------- утилиты ---------- */
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function today(off = 0){ const d = new Date(); d.setDate(d.getDate()+off); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
const pname = p => esc(p.title || UNTITLED);
const picon = p => esc(p.icon || '📄');
const stripHtml = html => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent || ''; };
function fmtDate(iso){
  if (!iso) return '';
  if (iso === today()) return 'сегодня';
  if (iso === today(1)) return 'завтра';
  if (iso === today(-1)) return 'вчера';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('ru-RU', {day:'numeric', month:'short', ...(y !== new Date().getFullYear() ? {year:'numeric'} : {})});
}

function ask(msg, okText = 'Удалить', cancel = true){
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div role="dialog"><p>${esc(msg)}</p><nav>${cancel?'<button data-r="0">Отмена</button>':''}<button class="ok" data-r="1">${esc(okText)}</button></nav></div>`;
    const close = v => { m.remove(); document.removeEventListener('keydown', onKey, true); res(v); };
    const onKey = e => {
      if (e.key === 'Escape'){ e.stopPropagation(); close(false); }
      if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); close(true); }
    };
    m.onclick = e => { if (e.target.dataset.r !== undefined || e.target === m) close(e.target.dataset.r === '1'); };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(m);
    m.querySelector('.ok').focus();
  });
}

/* ---------- данные ---------- */
let S;
let noSave = false; // если файл данных не удалось прочитать — не перезаписываем его

function seed(){
  const a = uid(), b = uid(), c = uid();
  const T = (text, status, due, pr, extra = {}) => ({id:uid(), text, status, due, time:'', pr, remind:'', desc:'', subs:[], ...extra});
  return { version:DATA_VERSION, theme:'light', sel:a, pages:[
    {id:a, parent:null, icon:'🏠', title:'Добро пожаловать', view:'list', open:true, fav:true,
     notes:'<p>Это ваше пространство. Создавайте страницы и подстраницы слева, пишите заметки здесь, а задачи ведите ниже — списком или доской.</p>',
     tasks:[
       T('Создать первую страницу','todo',today(),2),
       T('Открыть задачу и добавить подзадачи','todo','',3, {desc:'Щёлкните по свободному месту в строке задачи — откроется панель с деталями.', subs:[{id:uid(), text:'Написать описание', done:true}, {id:uid(), text:'Добавить подзадачу', done:false}]}),
       T('Переключить вид на «Доску»','todo','',3),
       T('Открыть приложение','done','',3)]},
    {id:b, parent:null, icon:'💼', title:'Работа', view:'board', open:true, fav:false, notes:'',
     tasks:[T('Подготовить отчёт','doing',today(1),1), T('Созвон с командой','todo',today(),2,{time:'15:00'}), T('Обновить план','todo','',3)]},
    {id:c, parent:b, icon:'🚀', title:'Проект', view:'list', open:true, fav:false, notes:'', tasks:[]},
  ]};
}

// Приводим данные любой старой версии к текущей. Формат данных меняем только здесь.
function migrate(d){
  if (!d || typeof d !== 'object' || !Array.isArray(d.pages)) throw new Error('Неверный формат данных');
  if (!d.version) d.version = 1; // данные прототипа (без версии) → версия 1
  if (d.version > DATA_VERSION) throw new Error('Данные созданы более новой версией Планера. Обновите приложение.');
  if (d.version < 2){
    // v2: время, напоминание, описание и подзадачи у задач, избранное у страниц
    for (const p of d.pages){
      p.fav = !!p.fav;
      p.tasks = (p.tasks || []).map(t => ({time:'', remind:'', desc:'', subs:[], ...t}));
    }
    d.version = 2;
  }
  // мягкая проверка полей, чтобы приложение не падало на неполных данных
  for (const p of d.pages){
    p.id = p.id || uid(); p.parent = p.parent ?? null; p.icon = p.icon || '📄'; p.title = p.title || '';
    p.notes = p.notes || ''; p.view = p.view === 'board' ? 'board' : 'list'; p.open = p.open !== false;
    p.tasks = Array.isArray(p.tasks) ? p.tasks : [];
    for (const t of p.tasks){
      t.id = t.id || uid(); t.text = t.text || ''; t.status = STAT[t.status] ? t.status : 'todo';
      t.due = t.due || ''; t.time = t.time || ''; t.pr = [1,2,3].includes(+t.pr) ? +t.pr : 3;
      t.remind = t.remind == null ? '' : String(t.remind); t.desc = t.desc || '';
      t.subs = Array.isArray(t.subs) ? t.subs : [];
    }
  }
  const ids = new Set(d.pages.map(p => p.id));
  for (const p of d.pages) if (p.parent && !ids.has(p.parent)) p.parent = null;
  d.theme = d.theme === 'dark' ? 'dark' : 'light';
  return d;
}

let saveT = null;
function flush(){
  if (saveT === null) return;
  clearTimeout(saveT); saveT = null;
  if (noSave) return;
  window.api.save(S).catch(err => { console.error(err); ask('Не удалось сохранить данные: ' + err.message, 'OK', false); });
  syncReminders();
}
// Сохранение с задержкой ~300 мс, чтобы не писать файл на каждое нажатие клавиши.
function save(){ clearTimeout(saveT); saveT = setTimeout(flush, 300); }
// При закрытии окна сохраняем синхронно всё, что ещё не записано.
window.addEventListener('beforeunload', () => {
  if (saveT !== null){ clearTimeout(saveT); saveT = null; if (!noSave) window.api.saveSync(S); }
});

async function loadData(){
  const res = await window.api.load();
  let msg = res.message || '';
  let d = res.data;
  if (!d){
    // Первый запуск: переносим данные прототипа из localStorage, если они есть.
    try { const old = JSON.parse(localStorage.getItem(KEY)); if (old && Array.isArray(old.pages)) d = old; } catch(e) {}
  }
  try {
    S = migrate(d || seed());
  } catch(e){
    S = migrate(seed());
    if (res.data){ noSave = true; msg = 'Не удалось открыть файл данных: ' + e.message + '\nИзменения не будут сохраняться, пока проблема не решена.'; }
  }
  if (res.status !== 'ok' || (res.data && res.data.version !== DATA_VERSION)) save();
  return msg;
}

const page = id => S.pages.find(p => p.id === id);
function findTask(tid){ for (const p of S.pages){ const t = p.tasks.find(t => t.id === tid); if (t) return [p, t]; } return []; }
function allTasks(){ return S.pages.flatMap(p => p.tasks.map(t => ({t, p}))); }
function descendants(id){ const out = [id]; S.pages.filter(p => p.parent === id).forEach(k => out.push(...descendants(k.id))); return out; }
function pagePath(p){ const out = []; let c = p; while (c && c.parent){ c = page(c.parent); if (c) out.unshift(c); } return out; }

/* ---------- напоминания ---------- */
// Время срабатывания напоминания (мс) или null
function remindAt(t){
  if (t.remind === '' || !t.due || t.status === 'done') return null;
  const [y, m, d] = t.due.split('-').map(Number);
  const [hh, mm] = (t.time || DEFAULT_TIME).split(':').map(Number);
  return new Date(y, m-1, d, hh, mm).getTime() - Number(t.remind) * 60000;
}
// Передаём главному процессу список будущих (и недавно пропущенных) напоминаний
function syncReminders(){
  if (!S) return;
  const list = [];
  const now = Date.now();
  for (const {t, p} of allTasks()){
    const at = remindAt(t);
    if (at === null || t.reminded === at || at < now - 24*3600e3) continue;
    const when = fmtDate(t.due) + (t.time ? ' в ' + t.time : '');
    list.push({ id:t.id, at, pageId:p.id, title:t.text || 'Задача', body:`${p.icon} ${p.title || UNTITLED} · срок ${when}` });
  }
  window.api.setReminders(list);
}

/* ---------- отмена удаления ---------- */
function toast(text, undo){
  const box = $('#toasts');
  box.querySelectorAll('.toast').forEach(x => x.remove()); // показываем только последнюю
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>${undo ? '<button>Отменить</button>' : ''}`;
  const hide = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  let timer = setTimeout(hide, 5000);
  el.onmouseenter = () => clearTimeout(timer);
  el.onmouseleave = () => { timer = setTimeout(hide, 2500); };
  if (undo) el.querySelector('button').onclick = () => { clearTimeout(timer); el.remove(); undo(); };
  box.appendChild(el);
}

/* ---------- боковая панель ---------- */
const nav = $('#nav');
function itemHtml(p, depth, {tree = false, fav = false} = {}){
  const kids = tree && S.pages.some(k => k.parent === p.id);
  return `<div class="item ${S.sel===p.id?'active':''}" style="padding-left:${8+depth*14}px" data-go="${p.id}" ${tree?`draggable="true" data-drag="${p.id}"`:''}>
    <span class="tw" ${kids?`data-tog="${p.id}"`:''}>${kids ? (p.open ? '▾' : '▸') : ''}</span>
    <span>${picon(p)}</span><span class="nm">${pname(p)}</span>
    <span class="acts">
      <b data-fav="${p.id}" class="${p.fav?'on':''}" title="${p.fav?'Убрать из избранного':'В избранное'}">${p.fav?'★':'☆'}</b>
      ${fav ? '' : `<b data-add="${p.id}" title="Подстраница">+</b><b data-del="${p.id}" title="Удалить">×</b>`}
    </span>
  </div>`;
}
function tree(parent, depth){
  return S.pages.filter(p => p.parent === parent).map(p => {
    const kids = S.pages.some(k => k.parent === p.id);
    return itemHtml(p, depth, {tree:true}) + (kids && p.open ? tree(p.id, depth+1) : '');
  }).join('');
}
function renderNav(){
  const td = today();
  const nToday = allTasks().filter(({t}) => t.status !== 'done' && t.due && t.due <= td).length;
  const favs = S.pages.filter(p => p.fav);
  let html = `
    <div class="item ${S.sel==='@today'?'active':''}" data-go="@today"><span class="tw"></span><span>☀️</span><span class="nm">Сегодня</span>${nToday?`<span class="badge">${nToday}</span>`:''}</div>
    <div class="item ${S.sel==='@all'?'active':''}" data-go="@all"><span class="tw"></span><span>🗂️</span><span class="nm">Все задачи</span></div>`;
  if (favs.length) html += `<div class="sec">Избранное</div>` + favs.map(p => itemHtml(p, 0, {fav:true})).join('');
  html += `<div class="sec">Страницы <button data-add="" title="Новая страница (${MOD}+N)">+</button></div>`;
  html += tree(null, 0) || `<div class="hint">Страниц пока нет.<br>Нажмите «+» или ${MOD}+N, чтобы создать первую.</div>`;
  nav.innerHTML = html;
}
nav.addEventListener('click', e => {
  const t = e.target.closest('[data-tog],[data-add],[data-del],[data-fav],[data-go]'); if (!t) return;
  if (t.dataset.tog){ const p = page(t.dataset.tog); p.open = !p.open; save(); renderNav(); return; }
  if (t.dataset.fav){ toggleFav(t.dataset.fav); return; }
  if (t.dataset.add !== undefined){ addPage(t.dataset.add || null); return; }
  if (t.dataset.del){ delPage(t.dataset.del); return; }
  if (t.dataset.go){ go(t.dataset.go); }
});

/* перетаскивание страниц: выше / ниже / внутрь другой страницы */
let dragPage = null, dropTarget = null;
const clearDropMarks = () => { nav.classList.remove('drop-root'); nav.querySelectorAll('.drop-before,.drop-after,.drop-in').forEach(x => x.classList.remove('drop-before','drop-after','drop-in')); };
nav.addEventListener('dragstart', e => {
  const it = e.target.closest('[data-drag]'); if (!it) return;
  dragPage = it.dataset.drag; it.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragPage);
});
nav.addEventListener('dragend', () => { dragPage = dropTarget = null; clearDropMarks(); nav.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); });
nav.addEventListener('dragover', e => {
  if (!dragPage) return;
  clearDropMarks(); dropTarget = null;
  const it = e.target.closest('[data-drag]');
  if (!it){ // пустое место под деревом — в конец, на верхний уровень
    if (!e.target.closest('.item,.sec')){ e.preventDefault(); nav.classList.add('drop-root'); dropTarget = {id:null, zone:'root'}; }
    return;
  }
  const id = it.dataset.drag;
  if (descendants(dragPage).includes(id)) return; // нельзя положить страницу в саму себя
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const r = it.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  const zone = y < .28 ? 'before' : y > .72 ? 'after' : 'in';
  it.classList.add('drop-' + zone); dropTarget = {id, zone};
});
nav.addEventListener('drop', e => {
  if (!dragPage || !dropTarget) return;
  e.preventDefault(); movePage(dragPage, dropTarget);
});
function movePage(id, {id:target, zone}){
  const p = page(id); if (!p || id === target) return;
  S.pages.splice(S.pages.indexOf(p), 1);
  if (zone === 'root'){ p.parent = null; S.pages.push(p); }
  else if (zone === 'in'){ p.parent = target; page(target).open = true; S.pages.push(p); }
  else {
    const t = page(target); p.parent = t.parent;
    S.pages.splice(S.pages.indexOf(t) + (zone === 'after' ? 1 : 0), 0, p);
  }
  save(); render();
}

function go(id){ S.sel = id; closeDetails(); save(); render(); $('#main').scrollTop = 0; }
function addPage(parent){
  const p = {id:uid(), parent, icon:'📄', title:'', notes:'', view:'list', open:true, fav:false, tasks:[]};
  if (parent) page(parent).open = true;
  S.pages.push(p); go(p.id);
  setTimeout(() => $('#title') && $('#title').focus(), 0);
}
function delPage(id){
  const p = page(id); if (!p) return;
  const ids = descendants(id);
  const removed = S.pages.map((x, i) => ({x, i})).filter(({x}) => ids.includes(x.id));
  S.pages = S.pages.filter(x => !ids.includes(x.id));
  const wasSel = S.sel;
  if (ids.includes(S.sel)) S.sel = p.parent && page(p.parent) ? p.parent : '@today';
  if (openTask && !findTask(openTask).length) closeDetails();
  save(); render();
  const extra = ids.length > 1 ? ` и ${ids.length-1} подстр.` : '';
  toast(`Страница «${p.title || UNTITLED}»${extra} удалена`, () => {
    for (const {x, i} of removed) S.pages.splice(Math.min(i, S.pages.length), 0, x);
    if (ids.includes(wasSel)) S.sel = wasSel;
    save(); render();
  });
}
function toggleFav(id){ const p = page(id); p.fav = !p.fav; save(); render(); }

/* ---------- основная часть ---------- */
const M = $('#main');
function dateCls(t){ if (!t.due || t.status === 'done') return ''; const td = today(); return t.due < td ? 'over' : t.due === td ? 'today' : ''; }
function metaHtml(t){
  const done = t.subs.filter(s => s.done).length;
  return [
    t.status === 'doing' ? '<span class="tag doing">В работе</span>' : '',
    t.subs.length ? `<span title="Подзадачи">☑ ${done}/${t.subs.length}</span>` : '',
    t.desc.trim() ? '<span title="Есть описание">≡</span>' : '',
    remindAt(t) !== null ? `<span title="Напоминание: ${esc(REMIND[t.remind] || '')}">🔔</span>` : '',
  ].join('');
}
function taskRow(t, p, showFrom){
  return `<div class="task ${t.status==='done'?'done':''} ${openTask===t.id?'sel':''}" data-tid="${t.id}">
    <input type="checkbox" data-act="chk" ${t.status==='done'?'checked':''} title="Выполнено">
    <span class="txt" contenteditable="true" spellcheck="false" data-act="txt">${esc(t.text)}</span>
    <span class="meta" title="Открыть задачу">${metaHtml(t)}</span>
    ${showFrom ? `<span class="from" data-go="${p.id}">${picon(p)} ${pname(p)}</span>` : ''}
    <input type="date" class="date ${dateCls(t)}" data-act="due" value="${t.due||''}" title="Срок">
    <input type="time" class="tm ${t.due?'':'off'} ${t.time?'':'noval'}" data-act="time" value="${t.time||''}" title="Время" ${t.due?'':'tabindex="-1"'}>
    <select class="pr pr${t.pr}" data-act="pr" title="Приоритет">${[1,2,3].map(n=>`<option value="${n}" ${t.pr==n?'selected':''}>${PR[n]}</option>`).join('')}</select>
    <button class="x" data-act="del" title="Удалить">×</button>
  </div>`;
}
const byDue = (a, b) => (a.status==='done') - (b.status==='done') || (a.due||'9999').localeCompare(b.due||'9999') || (a.time||'99').localeCompare(b.time||'99') || a.pr - b.pr;
const sortPairs = arr => [...arr].sort((x, y) => byDue(x.t, y.t));
const emptyHtml = (icon, text, hint) => `<div class="empty"><b>${icon}</b>${text}${hint?`<small>${hint}</small>`:''}</div>`;

function renderMain(){
  if (S.sel === '@today' || S.sel === '@all'){
    const td = today(), isToday = S.sel === '@today';
    const ts = allTasks();
    let body = '';
    if (isToday){
      const open = ts.filter(({t}) => t.status !== 'done' && t.due);
      const g = (name, arr) => arr.length ? `<div class="group">${name}</div>` + sortPairs(arr).map(({t, p}) => taskRow(t, p, true)).join('') : '';
      body = g('Просрочено', open.filter(({t}) => t.due < td))
           + g('Сегодня', open.filter(({t}) => t.due === td))
           + g('Ближайшие 7 дней', open.filter(({t}) => t.due > td && t.due <= today(7)))
           || emptyHtml('🎉', 'На сегодня задач нет — отличный день.', 'Здесь появляются задачи со сроком на сегодня, просроченные и на ближайшую неделю.');
    } else {
      body = S.pages.filter(p => p.tasks.length).map(p =>
        `<div class="group">${picon(p)} ${pname(p)}</div>` + sortPairs(p.tasks.map(t => ({t, p}))).map(({t}) => taskRow(t, p, false)).join('')
      ).join('') || emptyHtml('🗂️', 'Задач пока нет.', 'Откройте любую страницу слева и добавьте задачу.');
    }
    M.innerHTML = `<div class="page"><div class="icon" style="cursor:default">${isToday?'☀️':'🗂️'}</div>
      <div class="title">${isToday?'Сегодня':'Все задачи'}</div>
      <div class="crumbs">${new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}</div>
      <div style="margin-top:18px">${body}</div></div>`;
    return;
  }
  const p = page(S.sel);
  if (!p){ S.sel = '@today'; return renderMain(); }
  const crumbs = pagePath(p).map(c => `<span data-go="${c.id}">${picon(c)} ${pname(c)}</span>`).join(' / ');
  const done = p.tasks.filter(t => t.status === 'done').length;
  let tasksHtml;
  if (p.view === 'board'){
    tasksHtml = `<div class="board">${Object.keys(STAT).map(s => {
      const items = p.tasks.filter(t => t.status === s);
      return `<div class="col" data-col="${s}"><h4>${STAT[s]}<span>${items.length}</span></h4>${items.map(t => `
        <div class="card ${t.status==='done'?'done':''} ${openTask===t.id?'sel':''}" draggable="true" data-tid="${t.id}">
          <div style="display:flex;gap:6px"><div class="txt" contenteditable="true" spellcheck="false" data-act="txt" style="flex:1">${esc(t.text)}</div><button class="x" data-act="del" title="Удалить">×</button></div>
          <div class="row"><span class="dot" style="background:var(--p${t.pr})" title="${PR[t.pr].slice(2)} приоритет"></span>
          ${t.due ? `<span class="date ${dateCls(t)}" style="width:auto">${fmtDate(t.due)}${t.time?' '+t.time:''}</span>` : ''}
          ${metaHtml({...t, status:'todo'})}</div>
        </div>`).join('') || '<div class="colempty">Перетащите сюда карточку</div>'}</div>`; }).join('')}</div>`;
  } else {
    tasksHtml = sortPairs(p.tasks.map(t => ({t, p}))).map(({t}) => taskRow(t, p, false)).join('')
      || emptyHtml('✏️', 'Задач пока нет.', 'Введите название в поле выше и нажмите Enter.');
  }
  M.innerHTML = `<div class="page">
    <div class="toprow"><div class="crumbs">${crumbs || '&nbsp;'}</div>
      <button class="favbtn ${p.fav?'on':''}" data-act="fav" title="${p.fav?'Убрать из избранного':'Закрепить в избранном'}">${p.fav?'★ В избранном':'☆ В избранное'}</button></div>
    <div class="icon" id="icon" title="Сменить иконку">${picon(p)}</div>
    <input class="title" id="title" placeholder="${UNTITLED}" value="${esc(p.title)}">
    <div class="notes" id="notes" contenteditable="true" data-ph="Заметки… (Enter — новая строка, «- » в начале — список)">${p.notes}</div>
    <div class="thead"><h3>Задачи<span class="cnt">${done}/${p.tasks.length}</span></h3>
      <div class="seg"><button data-view="list" class="${p.view!=='board'?'on':''}">☰ Список</button><button data-view="board" class="${p.view==='board'?'on':''}">▦ Доска</button></div></div>
    <input class="add" id="addt" placeholder="+ Новая задача — введите и нажмите Enter">
    ${tasksHtml}
  </div>`;
}
function render(){ document.documentElement.dataset.theme = S.theme; document.body.classList.toggle('side-hidden', !!S.sideHidden); renderNav(); renderMain(); renderDetails(); }
// Перерисовать всё, кроме открытой панели задачи (чтобы не сбить фокус в ней)
function refresh(){ renderNav(); renderMain(); }

function deleteTask(tid){
  const [p, t] = findTask(tid); if (!t) return;
  const i = p.tasks.indexOf(t);
  p.tasks.splice(i, 1);
  if (openTask === tid) closeDetails();
  save(); render();
  toast(`Задача «${t.text || 'без названия'}» удалена`, () => {
    const pp = page(p.id); if (!pp) return;
    pp.tasks.splice(Math.min(i, pp.tasks.length), 0, t);
    save(); render();
  });
}

/* ---------- события основной части ---------- */
M.addEventListener('input', e => {
  const p = page(S.sel);
  if (e.target.id === 'title'){ p.title = e.target.value; save(); renderNav(); return; }
  if (e.target.id === 'notes'){ p.notes = e.target.innerHTML === '<br>' ? '' : e.target.innerHTML; save(); return; }
  const row = e.target.closest('[data-tid]'); if (!row) return;
  const [, t] = findTask(row.dataset.tid); if (!t) return;
  if (e.target.dataset.act === 'txt'){ t.text = e.target.textContent; save(); if (openTask === t.id) renderDetails(); }
});
M.addEventListener('change', e => {
  const row = e.target.closest('[data-tid]'); if (!row) return;
  const [, t] = findTask(row.dataset.tid); if (!t) return;
  const a = e.target.dataset.act;
  if (a === 'chk') t.status = e.target.checked ? 'done' : 'todo';
  if (a === 'due'){ t.due = e.target.value; if (!t.due) t.time = ''; }
  if (a === 'time') t.time = e.target.value;
  if (a === 'pr') t.pr = +e.target.value;
  delete t.reminded;
  save(); render();
});
M.addEventListener('click', e => {
  const el = e.target;
  const goEl = el.closest('[data-go]');
  if (goEl){ go(goEl.dataset.go); return; }
  if (el.dataset.view){ page(S.sel).view = el.dataset.view; save(); renderMain(); return; }
  if (el.dataset.act === 'fav'){ toggleFav(S.sel); return; }
  if (el.dataset.act === 'del'){ deleteTask(el.closest('[data-tid]').dataset.tid); return; }
  if (el.id === 'icon'){
    if (el.querySelector('.picker')){ el.querySelector('.picker').remove(); return; }
    el.insertAdjacentHTML('beforeend', `<div class="picker">${EMOJI.map(x => `<span data-emo="${x}">${x}</span>`).join('')}</div>`); return;
  }
  if (el.dataset.emo){ page(S.sel).icon = el.dataset.emo; save(); render(); return; }
  // клик по свободному месту задачи открывает панель с деталями
  const row = el.closest('[data-tid]');
  if (row && !el.closest('input,select,button,[contenteditable]')) openDetails(row.dataset.tid);
});
M.addEventListener('keydown', e => {
  if (e.target.id === 'addt' && e.key === 'Enter' && e.target.value.trim()){
    const p = page(S.sel);
    p.tasks.push({id:uid(), text:e.target.value.trim(), status:'todo', due:'', time:'', pr:3, remind:'', desc:'', subs:[]});
    save(); render(); $('#addt').focus();
  }
  if (e.target.id === 'title' && e.key === 'Enter'){ e.preventDefault(); $('#notes').focus(); }
  if (e.target.dataset.act === 'txt' && e.key === 'Enter'){ e.preventDefault(); e.target.blur(); }
  if (e.target.id === 'notes' && e.key === ' '){
    // «- » в начале строки превращается в маркированный список
    const sel = getSelection(), node = sel.anchorNode;
    if (node && node.nodeType === 3 && node.textContent.slice(0, sel.anchorOffset) === '-'){
      e.preventDefault(); node.textContent = node.textContent.slice(1);
      document.execCommand('insertUnorderedList');
    }
  }
});

/* перетаскивание карточек на доске */
let dragId = null;
M.addEventListener('dragstart', e => { const c = e.target.closest('.card'); if (!c) return; dragId = c.dataset.tid; c.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
M.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.drag,.over').forEach(x => x.classList.remove('drag','over')); });
M.addEventListener('dragover', e => { const col = e.target.closest('.col'); if (!col || !dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; document.querySelectorAll('.col.over').forEach(x => x !== col && x.classList.remove('over')); col.classList.add('over'); });
M.addEventListener('drop', e => {
  const col = e.target.closest('.col'); if (!col || !dragId) return; e.preventDefault();
  const [p, t] = findTask(dragId); t.status = col.dataset.col;
  const over = e.target.closest('.card');
  p.tasks = p.tasks.filter(x => x !== t);
  const idx = over ? p.tasks.findIndex(x => x.id === over.dataset.tid) : -1;
  idx >= 0 ? p.tasks.splice(idx, 0, t) : p.tasks.push(t);
  save(); render();
});

/* ---------- панель задачи ---------- */
let openTask = null;
const D = $('#details');
function openDetails(tid){ openTask = tid; renderDetails(); refresh(); setTimeout(() => D.querySelector('.d-title')?.focus(), 30); }
function closeDetails(){ if (!openTask) return; openTask = null; D.classList.remove('open'); document.body.classList.remove('details-open'); D.innerHTML = ''; if (S) refresh(); }
function pageOptions(sel){
  const out = [];
  const walk = (parent, depth) => S.pages.filter(p => p.parent === parent).forEach(p => {
    out.push(`<option value="${p.id}" ${p.id===sel?'selected':''}>${'  '.repeat(depth)}${picon(p)} ${pname(p)}</option>`);
    walk(p.id, depth + 1);
  });
  walk(null, 0);
  return out.join('');
}
function renderDetails(){
  if (!openTask){ D.classList.remove('open'); document.body.classList.remove('details-open'); return; }
  const [p, t] = findTask(openTask);
  if (!t){ openTask = null; D.classList.remove('open'); document.body.classList.remove('details-open'); return; }
  const sdone = t.subs.filter(s => s.done).length;
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${String(cur)===k?'selected':''}>${esc(v)}</option>`).join('');
  D.innerHTML = `
    <div class="d-head">
      <input type="checkbox" data-d="done" ${t.status==='done'?'checked':''} title="Выполнено">
      <span class="crumb" data-d="gopage" title="Открыть страницу">${picon(p)} ${pname(p)}</span>
      <button class="iconbtn" data-d="close" title="Закрыть (Esc)">✕</button>
    </div>
    <textarea class="d-title" data-d="text" rows="1" placeholder="Название задачи" spellcheck="false">${esc(t.text)}</textarea>
    <div class="d-grid">
      <label>Статус</label><select data-d="status">${opt(STAT, t.status)}</select>
      <label>Срок</label><div class="d-row"><input type="date" data-d="due" value="${t.due}"><input type="time" data-d="time" value="${t.time}" ${t.due?'':'disabled'} title="Время (необязательно)"></div>
      <label>Напоминание</label><select data-d="remind" ${t.due?'':'disabled'} title="${t.due?'':'Сначала укажите срок'}">${opt(REMIND, t.remind)}</select>
      <label>Приоритет</label><select data-d="pr">${opt({1:'Высокий', 2:'Средний', 3:'Низкий'}, t.pr)}</select>
      <label>Страница</label><select data-d="page">${pageOptions(p.id)}</select>
    </div>
    ${t.due && t.remind !== '' && !t.time ? `<div class="hint" style="padding:0 0 8px">Время не указано — напомню в ${DEFAULT_TIME}.</div>` : ''}
    <div class="d-sec">Описание</div>
    <textarea class="d-desc" data-d="desc" placeholder="Добавьте подробности…">${esc(t.desc)}</textarea>
    <div class="d-sec">Подзадачи${t.subs.length?`<span class="cnt">${sdone}/${t.subs.length}</span>`:''}</div>
    <div class="subs">${t.subs.map(s => `<div class="sub ${s.done?'done':''}" data-sid="${s.id}">
      <input type="checkbox" data-d="sub-chk" ${s.done?'checked':''}>
      <input class="stxt" data-d="sub-txt" value="${esc(s.text)}" spellcheck="false">
      <button class="x" data-d="sub-del" title="Удалить подзадачу">×</button></div>`).join('')}</div>
    <input class="add" data-d="sub-add" placeholder="+ Подзадача — введите и нажмите Enter">
    <div class="d-foot"><span>Esc — закрыть</span><button class="danger" data-d="delete">Удалить задачу</button></div>`;
  D.classList.add('open'); document.body.classList.add('details-open');
  fitTitle();
}
function fitTitle(){ const ta = D.querySelector('.d-title'); if (ta){ ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; } }
function curTask(){ return findTask(openTask); }
D.addEventListener('input', e => {
  const [, t] = curTask(); if (!t) return;
  const a = e.target.dataset.d;
  if (a === 'text'){ t.text = e.target.value.replace(/\n/g, ' '); fitTitle(); save(); refresh(); }
  if (a === 'desc'){ t.desc = e.target.value; save(); }
  if (a === 'sub-txt'){ const s = t.subs.find(s => s.id === e.target.closest('[data-sid]').dataset.sid); s.text = e.target.value; save(); }
});
D.addEventListener('change', e => {
  const [p, t] = curTask(); if (!t) return;
  const a = e.target.dataset.d, v = e.target.value;
  if (a === 'done') t.status = e.target.checked ? 'done' : 'todo';
  else if (a === 'status') t.status = v;
  else if (a === 'due'){ t.due = v; if (!v){ t.time = ''; t.remind = ''; } }
  else if (a === 'time') t.time = v;
  else if (a === 'remind') t.remind = v;
  else if (a === 'pr') t.pr = +v;
  else if (a === 'page'){ p.tasks = p.tasks.filter(x => x !== t); page(v).tasks.push(t); }
  else if (a === 'sub-chk'){ t.subs.find(s => s.id === e.target.closest('[data-sid]').dataset.sid).done = e.target.checked; }
  else return;
  if (['due','time','remind','status','done'].includes(a)) delete t.reminded;
  save(); render();
});
D.addEventListener('click', e => {
  const a = e.target.dataset.d;
  if (a === 'close') closeDetails();
  if (a === 'gopage'){ const [p] = curTask(); const tid = openTask; go(p.id); openDetails(tid); }
  if (a === 'delete') deleteTask(openTask);
  if (a === 'sub-del'){ const [, t] = curTask(); t.subs = t.subs.filter(s => s.id !== e.target.closest('[data-sid]').dataset.sid); save(); render(); }
});
D.addEventListener('keydown', e => {
  const a = e.target.dataset.d;
  if (a === 'text' && e.key === 'Enter'){ e.preventDefault(); D.querySelector('.d-desc').focus(); }
  if (a === 'sub-add' && e.key === 'Enter' && e.target.value.trim()){
    const [, t] = curTask(); t.subs.push({id:uid(), text:e.target.value.trim(), done:false});
    save(); render(); D.querySelector('[data-d="sub-add"]').focus();
  }
  if (a === 'sub-txt' && e.key === 'Enter'){ e.preventDefault(); D.querySelector('[data-d="sub-add"]').focus(); }
});
// клик мимо панели закрывает её (но не клик по другой задаче — тогда откроется она)
document.addEventListener('mousedown', e => {
  if (!openTask || D.contains(e.target) || e.target.closest('[data-tid],.modal,.toast,.pal-wrap')) return;
  closeDetails();
});

/* ---------- быстрый поиск (палитра) ---------- */
let pal = null;
function openPalette(){
  if (pal){ pal.input.focus(); pal.input.select(); return; }
  const wrap = document.createElement('div'); wrap.className = 'pal-wrap';
  wrap.innerHTML = `<div class="palette" role="dialog"><input placeholder="Поиск страниц и задач…" spellcheck="false"><div class="pal-list"></div>
    <div class="pal-foot">↑↓ — выбрать · Enter — открыть · Esc — закрыть</div></div>`;
  document.body.appendChild(wrap);
  pal = {wrap, input: wrap.querySelector('input'), list: wrap.querySelector('.pal-list'), items: [], idx: 0};
  pal.input.addEventListener('input', () => { pal.idx = 0; palRender(); });
  pal.input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown'){ e.preventDefault(); pal.idx = Math.min(pal.idx + 1, pal.items.length - 1); palMark(); }
    if (e.key === 'ArrowUp'){ e.preventDefault(); pal.idx = Math.max(pal.idx - 1, 0); palMark(); }
    if (e.key === 'Enter'){ e.preventDefault(); palRun(pal.idx); }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closePalette(); }
  });
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) closePalette(); });
  pal.list.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) palRun(+it.dataset.i); });
  pal.list.addEventListener('mousemove', e => { const it = e.target.closest('[data-i]'); if (it && +it.dataset.i !== pal.idx){ pal.idx = +it.dataset.i; palMark(); } });
  palRender(); pal.input.focus();
}
function closePalette(){ if (!pal) return; pal.wrap.remove(); pal = null; }
function hl(text, q){
  const s = String(text || ''), i = q ? s.toLowerCase().indexOf(q) : -1;
  if (i < 0) return esc(s);
  return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + q.length)) + '</mark>' + esc(s.slice(i + q.length));
}
function palRender(){
  const q = pal.input.value.trim().toLowerCase();
  const items = [];
  const pageItem = p => ({group:'Страницы', html:`<span>${picon(p)}</span><span class="nm">${hl(p.title || UNTITLED, q)}</span><small>${pagePath(p).map(c => esc(c.title || UNTITLED)).join(' / ')}</small>`, run:() => go(p.id)});
  if (!q){
    items.push({group:'Перейти', html:'<span>☀️</span><span class="nm">Сегодня</span>', run:() => go('@today')});
    items.push({group:'Перейти', html:'<span>🗂️</span><span class="nm">Все задачи</span>', run:() => go('@all')});
    S.pages.filter(p => p.fav).concat(S.pages.filter(p => !p.fav)).slice(0, 12).forEach(p => items.push(pageItem(p)));
  } else {
    S.pages.filter(p => (p.title || UNTITLED).toLowerCase().includes(q) || stripHtml(p.notes).toLowerCase().includes(q))
      .slice(0, 20).forEach(p => items.push(pageItem(p)));
    for (const {t, p} of sortPairs(allTasks())){
      const subHit = t.subs.find(s => s.text.toLowerCase().includes(q));
      const descHit = t.desc.toLowerCase().includes(q);
      if (!t.text.toLowerCase().includes(q) && !subHit && !descHit) continue;
      const extra = t.text.toLowerCase().includes(q) ? '' : subHit ? ' · подзадача: ' + subHit.text : ' · в описании';
      items.push({group:'Задачи', html:`<span>${t.status==='done'?'☑':'☐'}</span><span class="nm ${t.status==='done'?'done':''}">${hl(t.text || 'Без названия', q)}<small>${esc(extra)}</small></span><small>${picon(p)} ${pname(p)}${t.due?' · '+fmtDate(t.due):''}</small>`,
        run:() => { go(p.id); openDetails(t.id); }});
      if (items.length > 60) break;
    }
  }
  pal.items = items;
  let last = '';
  pal.list.innerHTML = items.map((it, i) => (it.group !== last ? `<div class="pal-group">${(last = it.group)}</div>` : '') +
    `<div class="pal-item" data-i="${i}">${it.html}</div>`).join('') || '<div class="hint" style="padding:14px">Ничего не найдено</div>';
  palMark();
}
function palMark(){
  pal.list.querySelectorAll('.pal-item').forEach(x => x.classList.toggle('on', +x.dataset.i === pal.idx));
  pal.list.querySelector('.pal-item.on')?.scrollIntoView({block:'nearest'});
}
function palRun(i){ const it = pal.items[i]; if (!it) return; closePalette(); it.run(); }

/* ---------- тема, панель, экспорт, импорт ---------- */
function toggleTheme(){ S.theme = S.theme === 'dark' ? 'light' : 'dark'; save(); render(); }
function toggleSidebar(){ S.sideHidden = !S.sideHidden; save(); document.body.classList.toggle('side-hidden', S.sideHidden); }
async function exportData(){
  flush();
  try {
    const r = await window.api.exportData(JSON.stringify(S, null, 2));
    if (r.ok) toast('Данные сохранены: ' + r.path);
  } catch(err){ ask('Не удалось сохранить файл: ' + err.message, 'OK', false); }
}
async function importData(){
  let r;
  try { r = await window.api.importData(); } catch(err){ ask('Не удалось открыть файл: ' + err.message, 'OK', false); return; }
  if (r.canceled) return;
  let nd;
  try { nd = migrate(JSON.parse(r.text)); } catch(err){ ask('Не удалось прочитать файл: это не файл данных Планера.\n' + err.message, 'OK', false); return; }
  if (await ask('Заменить текущие данные импортированными?\nЕсли хотите сохранить текущие — сначала сделайте экспорт.', 'Заменить')){
    closeDetails(); S = nd; noSave = false; save(); render();
    toast('Данные импортированы');
  }
}
$('#theme').onclick = toggleTheme;
$('#exp').onclick = exportData;
$('#imp').onclick = importData;
$('#searchBtn').onclick = openPalette;
$('#hideSide').onclick = toggleSidebar;
$('#showSide').onclick = toggleSidebar;

// Команды из меню приложения и уведомлений
window.api.onCommand((cmd, arg) => {
  if (!S) return;
  if (cmd === 'new-page') addPage(null);
  if (cmd === 'export') exportData();
  if (cmd === 'import') importData();
  if (cmd === 'toggle-theme') toggleTheme();
  if (cmd === 'toggle-sidebar') toggleSidebar();
  if (cmd === 'palette') openPalette();
  if (cmd === 'open-task'){ if (page(arg.pageId)) go(arg.pageId); if (findTask(arg.taskId).length) openDetails(arg.taskId); }
  if (cmd === 'reminded'){ const [, t] = findTask(arg.id); if (t){ t.reminded = arg.at; save(); } }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){
    if (pal){ closePalette(); return; }
    if ($('.picker')){ $('.picker').remove(); return; }
    if (openTask && !e.defaultPrevented){ closeDetails(); return; }
  }
});
document.addEventListener('click', e => { if (!e.target.closest('#icon')) document.querySelectorAll('.picker').forEach(x => x.remove()); });

/* ---------- запуск ---------- */
let MOD = 'Ctrl';
window.api.info().then(info => {
  const mac = info.platform === 'darwin';
  MOD = mac ? '⌘' : 'Ctrl';
  document.body.classList.toggle('mac', mac);
  $('#kbdK').textContent = MOD + (mac ? 'K' : ' K');
  $('#hideSide').title = `Скрыть панель (${MOD}+\\)`;
  return loadData();
}).then(msg => {
  render();
  syncReminders();
  // раз в минуту обновляем «Сегодня» и подсветку сроков (например, после полуночи)
  let day = today();
  setInterval(() => { if (today() !== day){ day = today(); refresh(); } }, 60000);
  if (msg) ask(msg, 'OK', false);
});
