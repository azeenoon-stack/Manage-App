const KEY = 'planer-v1';
const EMOJI = ['📄','🏠','💼','📌','🎯','✅','📚','💡','🛒','✈️','🏋️','🎨','💰','🧠','📅','🔥','⭐','🌱','🎵','🍳','🧩','🚀','❤️','📝'];
const STAT = {todo:'Сделать', doing:'В работе', done:'Готово'};
const PR = {1:'● Высокий', 2:'● Средний', 3:'● Низкий'};
function ask(msg, okText = 'Удалить', cancel = true){
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div><p>${esc(msg)}</p><nav>${cancel?'<button data-r="0">Отмена</button>':''}<button class="ok" data-r="1">${okText}</button></nav></div>`;
    m.onclick = e => { if (e.target.dataset.r !== undefined || e.target === m){ m.remove(); res(e.target.dataset.r === '1'); } };
    document.body.appendChild(m);
  });
}
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function today(off = 0){ const d = new Date(); d.setDate(d.getDate()+off); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }

function seed(){
  const a = uid(), b = uid(), c = uid();
  const T = (text, status, due, pr) => ({id:uid(), text, status, due, pr});
  return { version:DATA_VERSION, theme:'light', sel:a, pages:[
    {id:a, parent:null, icon:'🏠', title:'Добро пожаловать', view:'list', open:true,
     notes:'<p>Это ваше пространство. Создавайте страницы и подстраницы слева, пишите заметки здесь, а задачи ведите ниже — списком или доской.</p>',
     tasks:[T('Создать первую страницу','todo',today(),2), T('Переключить вид на «Доску»','todo','',3), T('Открыть приложение','done','',3)]},
    {id:b, parent:null, icon:'💼', title:'Работа', view:'board', open:true, notes:'',
     tasks:[T('Подготовить отчёт','doing',today(1),1), T('Созвон с командой','todo',today(),2), T('Обновить план','todo','',3)]},
    {id:c, parent:b, icon:'🚀', title:'Проект', view:'list', open:true, notes:'', tasks:[]},
  ]};
}
/* ---------- данные ---------- */
const DATA_VERSION = 1;
let S;
// Приводим данные любой старой версии к текущей. Формат меняем только здесь.
function migrate(d){
  if (!d || !Array.isArray(d.pages)) throw new Error('Неверный формат данных');
  if (!d.version){ // данные прототипа (без версии) → версия 1
    d.version = 1;
  }
  return d;
}
let saveT = null;
function flush(){
  if (saveT === null) return;
  clearTimeout(saveT); saveT = null;
  window.api.save(S).catch(err => { console.error(err); ask('Не удалось сохранить данные: ' + err.message, 'OK', false); });
}
// Сохранение с задержкой ~300 мс, чтобы не писать файл на каждое нажатие клавиши.
function save(){ clearTimeout(saveT); saveT = setTimeout(flush, 300); }
// При закрытии окна сохраняем синхронно всё, что ещё не записано.
window.addEventListener('beforeunload', () => {
  if (saveT !== null){ clearTimeout(saveT); saveT = null; window.api.saveSync(S); }
});
async function loadData(){
  const res = await window.api.load();
  let msg = res.message || '';
  if (res.data){
    S = res.data;
  } else {
    // Первый запуск: переносим данные прототипа из localStorage, если они есть.
    let old = null;
    try { old = JSON.parse(localStorage.getItem(KEY)); } catch(e) {}
    S = old && Array.isArray(old.pages) ? old : seed();
  }
  try { S = migrate(S); } catch(e){ S = migrate(seed()); }
  if (res.status !== 'ok'){ save(); }
  return msg;
}

const page = id => S.pages.find(p => p.id === id);
function findTask(tid){ for (const p of S.pages){ const t = p.tasks.find(t => t.id === tid); if (t) return [p, t]; } return []; }
function allTasks(){ return S.pages.flatMap(p => p.tasks.map(t => ({...t, _p:p}))); }
function descendants(id){ const out=[id]; S.pages.filter(p=>p.parent===id).forEach(k=>out.push(...descendants(k.id))); return out; }

/* ---------- sidebar ---------- */
function tree(parent, depth){
  return S.pages.filter(p => p.parent === parent).map(p => {
    const kids = S.pages.some(k => k.parent === p.id);
    return `<div class="item ${S.sel===p.id?'active':''}" style="padding-left:${8+depth*14}px" data-go="${p.id}">
      <span class="tw" data-tog="${p.id}">${kids ? (p.open ? '▾' : '▸') : ''}</span>
      <span>${p.icon}</span><span class="nm">${esc(p.title || 'Без названия')}</span>
      <span class="acts"><b data-add="${p.id}" title="Подстраница">+</b><b data-del="${p.id}" title="Удалить">×</b></span>
    </div>` + (kids && p.open ? tree(p.id, depth+1) : '');
  }).join('');
}
function renderNav(){
  const q = $('#q').value.trim().toLowerCase();
  const td = today();
  const nToday = allTasks().filter(t => t.status !== 'done' && t.due && t.due <= td).length;
  let html = `
    <div class="item ${S.sel==='@today'?'active':''}" data-go="@today"><span class="tw"></span><span>☀️</span><span class="nm">Сегодня</span>${nToday?`<span class="badge">${nToday}</span>`:''}</div>
    <div class="item ${S.sel==='@all'?'active':''}" data-go="@all"><span class="tw"></span><span>🗂️</span><span class="nm">Все задачи</span></div>
    <div class="sec">Страницы <button data-add="" title="Новая страница (Ctrl/⌘+N)">+</button></div>`;
  if (q){
    const hits = S.pages.filter(p => (p.title||'').toLowerCase().includes(q) || (p.notes||'').toLowerCase().includes(q));
    html += hits.map(p => `<div class="item ${S.sel===p.id?'active':''}" data-go="${p.id}"><span class="tw"></span><span>${p.icon}</span><span class="nm">${esc(p.title||'Без названия')}</span></div>`).join('') || '<div class="empty">Ничего не найдено</div>';
  } else html += tree(null, 0);
  $('#nav').innerHTML = html;
}
$('#nav').addEventListener('click', e => {
  const t = e.target.closest('[data-tog],[data-add],[data-del],[data-go]'); if (!t) return;
  if (t.dataset.tog && t.textContent.trim()){ const p = page(t.dataset.tog); p.open = !p.open; save(); renderNav(); return; }
  if (t.dataset.add !== undefined){ addPage(t.dataset.add || null); return; }
  if (t.dataset.del){ delPage(t.dataset.del); return; }
  if (t.dataset.go){ go(t.dataset.go); }
});
$('#q').addEventListener('input', renderNav);

function go(id){ S.sel = id; save(); render(); }
function addPage(parent){
  const p = {id:uid(), parent, icon:'📄', title:'', notes:'', view:'list', open:true, tasks:[]};
  if (parent) page(parent).open = true;
  S.pages.push(p); go(p.id);
  setTimeout(() => $('#title') && $('#title').focus(), 0);
}
async function delPage(id){
  const p = page(id), ids = descendants(id);
  const extra = ids.length > 1 ? ` и ${ids.length-1} подстраниц(ы)` : '';
  if (!await ask(`Удалить «${p.title || 'Без названия'}»${extra}?`)) return;
  S.pages = S.pages.filter(x => !ids.includes(x.id));
  if (ids.includes(S.sel)) S.sel = S.pages[0] ? S.pages[0].id : '@today';
  save(); render();
}

/* ---------- main ---------- */
function dateCls(t){ if (!t.due || t.status==='done') return ''; const td = today(); return t.due < td ? 'over' : t.due === td ? 'today' : ''; }
function taskRow(t, showFrom){
  return `<div class="task ${t.status==='done'?'done':''}" data-tid="${t.id}">
    <input type="checkbox" data-act="chk" ${t.status==='done'?'checked':''}>
    <span class="txt" contenteditable="true" spellcheck="false" data-act="txt">${esc(t.text)}</span>
    ${showFrom ? `<span class="from" data-go="${t._p.id}">${t._p.icon} ${esc(t._p.title||'Без названия')}</span>` : ''}
    <input type="date" class="date ${dateCls(t)}" data-act="due" value="${t.due||''}">
    <select class="pr pr${t.pr}" data-act="pr">${[1,2,3].map(n=>`<option value="${n}" ${t.pr==n?'selected':''}>${PR[n]}</option>`).join('')}</select>
    <button class="x" data-act="del" title="Удалить">×</button>
  </div>`;
}
function sortTasks(ts){ return [...ts].sort((a,b) => (a.status==='done') - (b.status==='done') || (a.due||'9999').localeCompare(b.due||'9999') || a.pr - b.pr); }

function renderMain(){
  const m = $('#main');
  if (S.sel === '@today' || S.sel === '@all'){
    const td = today(), isToday = S.sel === '@today';
    const ts = allTasks();
    let body = '';
    if (isToday){
      const over = sortTasks(ts.filter(t => t.status!=='done' && t.due && t.due < td));
      const now = sortTasks(ts.filter(t => t.status!=='done' && t.due === td));
      const soon = sortTasks(ts.filter(t => t.status!=='done' && t.due > td && t.due <= today(7)));
      const g = (name, arr) => arr.length ? `<div class="group">${name}</div>` + arr.map(t => taskRow(t, true)).join('') : '';
      body = g('Просрочено', over) + g('Сегодня', now) + g('Ближайшие 7 дней', soon) || '<div class="empty">На сегодня задач нет — отличный день 🎉</div>';
    } else {
      body = S.pages.filter(p => p.tasks.length).map(p => `<div class="group">${p.icon} ${esc(p.title||'Без названия')}</div>` + sortTasks(p.tasks.map(t => ({...t,_p:p}))).map(t => taskRow(t, false)).join('')).join('') || '<div class="empty">Задач пока нет</div>';
    }
    m.innerHTML = `<div class="page"><div class="icon" style="cursor:default">${isToday?'☀️':'🗂️'}</div>
      <div class="title">${isToday?'Сегодня':'Все задачи'}</div>
      <div class="crumbs">${new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}</div>
      <div style="margin-top:18px">${body}</div></div>`;
    return;
  }
  const p = page(S.sel);
  if (!p){ S.sel = '@today'; return renderMain(); }
  const crumbs = []; let c = p; while (c.parent){ c = page(c.parent); if (!c) break; crumbs.unshift(`${c.icon} ${esc(c.title||'Без названия')}`); }
  const done = p.tasks.filter(t => t.status==='done').length;
  let tasksHtml;
  if (p.view === 'board'){
    tasksHtml = `<div class="board">${Object.keys(STAT).map(s => {
      const items = p.tasks.filter(t => t.status === s);
      return `<div class="col" data-col="${s}"><h4>${STAT[s]}<span>${items.length}</span></h4>${items.map(t => `
        <div class="card" draggable="true" data-tid="${t.id}">
          <div style="display:flex;gap:6px"><div class="txt" contenteditable="true" data-act="txt" style="flex:1">${esc(t.text)}</div><button class="x" data-act="del">×</button></div>
          <div class="row"><span class="dot" style="background:var(--p${t.pr})"></span>
          <input type="date" class="date ${dateCls(t)}" data-act="due" value="${t.due||''}"></div>
        </div>`).join('')}</div>`; }).join('')}</div>`;
  } else {
    tasksHtml = sortTasks(p.tasks).map(t => taskRow(t, false)).join('') || '<div class="empty">Задач пока нет — добавьте первую выше</div>';
  }
  m.innerHTML = `<div class="page">
    <div class="crumbs">${crumbs.join(' / ') || '&nbsp;'}</div>
    <div class="icon" id="icon">${p.icon}</div>
    <input class="title" id="title" placeholder="Без названия" value="${esc(p.title)}">
    <div class="notes" id="notes" contenteditable="true" data-ph="Заметки… (Enter — новая строка, «- » в начале — список)">${p.notes}</div>
    <div class="thead"><h3>Задачи<span class="cnt">${done}/${p.tasks.length}</span></h3>
      <div class="seg"><button data-view="list" class="${p.view!=='board'?'on':''}">☰ Список</button><button data-view="board" class="${p.view==='board'?'on':''}">▦ Доска</button></div></div>
    <input class="add" id="addt" placeholder="+ Новая задача — введите и нажмите Enter">
    ${tasksHtml}
  </div>`;
  if (!p.title) $('#title').focus();
}
function render(){ document.documentElement.dataset.theme = S.theme; renderNav(); renderMain(); }

/* ---------- main events ---------- */
const M = $('#main');
M.addEventListener('input', e => {
  const p = page(S.sel);
  if (e.target.id === 'title'){ p.title = e.target.value; save(); renderNav(); return; }
  if (e.target.id === 'notes'){
    p.notes = e.target.innerHTML === '<br>' ? '' : e.target.innerHTML; save(); return;
  }
  const row = e.target.closest('[data-tid]'); if (!row) return;
  const [, t] = findTask(row.dataset.tid); if (!t) return;
  if (e.target.dataset.act === 'txt'){ t.text = e.target.textContent; save(); }
});
M.addEventListener('change', e => {
  const row = e.target.closest('[data-tid]'); if (!row) return;
  const [, t] = findTask(row.dataset.tid); if (!t) return;
  const a = e.target.dataset.act;
  if (a === 'chk') t.status = e.target.checked ? 'done' : 'todo';
  if (a === 'due') t.due = e.target.value;
  if (a === 'pr') t.pr = +e.target.value;
  save(); render();
});
M.addEventListener('click', e => {
  const el = e.target;
  if (el.dataset.go){ go(el.dataset.go); return; }
  if (el.dataset.view){ page(S.sel).view = el.dataset.view; save(); renderMain(); return; }
  if (el.dataset.act === 'del'){
    const row = el.closest('[data-tid]'); const [p] = findTask(row.dataset.tid);
    p.tasks = p.tasks.filter(t => t.id !== row.dataset.tid); save(); render(); return;
  }
  if (el.id === 'icon'){
    if (el.querySelector('.picker')) { el.querySelector('.picker').remove(); return; }
    el.insertAdjacentHTML('beforeend', `<div class="picker">${EMOJI.map(x => `<span data-emo="${x}">${x}</span>`).join('')}</div>`); return;
  }
  if (el.dataset.emo){ page(S.sel).icon = el.dataset.emo; save(); render(); }
});
M.addEventListener('keydown', e => {
  if (e.target.id === 'addt' && e.key === 'Enter' && e.target.value.trim()){
    const p = page(S.sel);
    p.tasks.push({id:uid(), text:e.target.value.trim(), status:'todo', due:'', pr:3});
    save(); render(); $('#addt').focus();
  }
  if (e.target.id === 'title' && e.key === 'Enter'){ e.preventDefault(); $('#notes').focus(); }
  if (e.target.dataset.act === 'txt' && e.key === 'Enter'){ e.preventDefault(); e.target.blur(); }
  if (e.target.id === 'notes' && e.key === ' '){
    // "- " at line start → bullet list
    const sel = getSelection(), node = sel.anchorNode;
    if (node && node.nodeType === 3 && node.textContent.slice(0, sel.anchorOffset) === '-' ){
      e.preventDefault(); node.textContent = node.textContent.slice(1);
      document.execCommand('insertUnorderedList');
    }
  }
});
M.addEventListener('focusout', e => { if (e.target.dataset.act === 'txt') render(); });

/* drag & drop on board */
let dragId = null;
M.addEventListener('dragstart', e => { const c = e.target.closest('.card'); if (!c) return; dragId = c.dataset.tid; c.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
M.addEventListener('dragend', () => { dragId = null; document.querySelectorAll('.drag,.over').forEach(x => x.classList.remove('drag','over')); });
M.addEventListener('dragover', e => { const col = e.target.closest('.col'); if (!col || !dragId) return; e.preventDefault(); document.querySelectorAll('.col.over').forEach(x => x !== col && x.classList.remove('over')); col.classList.add('over'); });
M.addEventListener('drop', e => {
  const col = e.target.closest('.col'); if (!col || !dragId) return; e.preventDefault();
  const [p, t] = findTask(dragId); t.status = col.dataset.col;
  const over = e.target.closest('.card');
  p.tasks = p.tasks.filter(x => x !== t);
  const idx = over ? p.tasks.findIndex(x => x.id === over.dataset.tid) : -1;
  idx >= 0 ? p.tasks.splice(idx, 0, t) : p.tasks.push(t);
  save(); render();
});

/* ---------- тема, экспорт, импорт ---------- */
function toggleTheme(){ S.theme = S.theme === 'dark' ? 'light' : 'dark'; save(); render(); }
async function exportData(){
  flush();
  try {
    const r = await window.api.exportData(JSON.stringify(S, null, 2));
    if (r.ok) ask('Данные сохранены в файл:\n' + r.path, 'OK', false);
  } catch(err){ ask('Не удалось сохранить файл: ' + err.message, 'OK', false); }
}
async function importData(){
  let r;
  try { r = await window.api.importData(); } catch(err){ ask('Не удалось открыть файл: ' + err.message, 'OK', false); return; }
  if (r.canceled) return;
  let nd;
  try { nd = migrate(JSON.parse(r.text)); } catch(err){ ask('Не удалось прочитать файл: это не файл данных Планера.', 'OK', false); return; }
  if (await ask('Заменить текущие данные импортированными?', 'Заменить')){ S = nd; save(); render(); }
}
$('#theme').onclick = toggleTheme;
$('#exp').onclick = exportData;
$('#imp').onclick = importData;

// Команды из меню приложения
window.api.onCommand(cmd => {
  if (cmd === 'new-page') addPage(null);
  if (cmd === 'export') exportData();
  if (cmd === 'import') importData();
  if (cmd === 'toggle-theme') toggleTheme();
  if (cmd === 'palette') $('#q').focus();
});
document.addEventListener('click', e => { if (!e.target.closest('#icon')) document.querySelectorAll('.picker').forEach(x => x.remove()); });

window.api.info().then(info => { document.body.classList.toggle('mac', info.platform === 'darwin'); });
loadData().then(msg => { render(); if (msg) ask(msg, 'OK', false); });
