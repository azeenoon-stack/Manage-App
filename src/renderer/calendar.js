'use strict';
/* Календарь задач в стиле Google Календаря: вид «Месяц» и «Неделя».
   Задачи берутся из поля «срок» (t.due) и «время» (t.time).
   Подключается после app.js и пользуется его функциями (S, save, render, openDetails…). */

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DOW = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const HOUR_PX = 48; // высота часа в виде «Неделя»
const MAX_CHIPS = 3; // сколько задач показывать в клетке месяца, остальные — «ещё N»

let calCursor = today(); // любая дата внутри показываемого месяца/недели
let calPop = null;       // открытая всплывашка (список дня или быстрое создание)

/* ---------- даты ---------- */
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dateOf = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const mondayOf = iso => { const d = dateOf(iso); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return isoOf(d); };
const calView = () => S.calView === 'week' ? 'week' : 'month';

// Задачи по дням: { 'ГГГГ-ММ-ДД': [{t, p}, …] }, внутри дня — сначала без времени, потом по времени
function tasksByDay(from, to){
  const map = {};
  for (const {t, p} of allTasks()){
    if (!t.due || t.due < from || t.due > to) continue;
    (map[t.due] ||= []).push({t, p});
  }
  for (const k in map) map[k].sort((a, b) => (a.t.time ? 1 : 0) - (b.t.time ? 1 : 0) || (a.t.time||'').localeCompare(b.t.time||'') || a.t.pr - b.t.pr);
  return map;
}

/* ---------- отрисовка ---------- */
function chipHtml({t, p}, mode = 'month'){
  const done = t.status === 'done' ? 'done' : '';
  const tip = esc(`${t.text || 'Без названия'}\n${p.icon} ${p.title || UNTITLED}${t.time ? '\n' + t.time : ''}`);
  if (mode === 'month' && t.time){
    // задача со временем: точка цвета приоритета + время, как событие в Google Календаре
    return `<div class="chip timed ${done}" draggable="true" data-tid="${t.id}" title="${tip}"><i class="dot" style="background:var(--p${t.pr})"></i><b>${t.time}</b><span>${esc(t.text || 'Без названия')}</span></div>`;
  }
  return `<div class="chip allday pr-bg${t.pr} ${done}" draggable="true" data-tid="${t.id}" title="${tip}"><span>${esc(t.text || 'Без названия')}</span></div>`;
}

function calTitle(){
  if (calView() === 'month'){ const d = dateOf(calCursor); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
  const a = dateOf(mondayOf(calCursor)), b = dateOf(addDays(mondayOf(calCursor), 6));
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS_GEN[a.getMonth()]} ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) return `${a.getDate()} ${MONTHS_GEN[a.getMonth()]} – ${b.getDate()} ${MONTHS_GEN[b.getMonth()]} ${b.getFullYear()}`;
  return `${a.getDate()} ${MONTHS_GEN[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MONTHS_GEN[b.getMonth()]} ${b.getFullYear()}`;
}

function renderCalendar(){
  calPop = null;
  const view = calView();
  const head = `<div class="cal-head">
      <span class="cal-logo">📅</span><h1>Календарь</h1>
      <button class="cal-btn" data-cal="today">Сегодня</button>
      <button class="cal-nav" data-cal="prev" title="Назад">‹</button><button class="cal-nav" data-cal="next" title="Вперёд">›</button>
      <h2>${calTitle()}</h2>
      <div class="seg"><button data-calview="week" class="${view==='week'?'on':''}">Неделя</button><button data-calview="month" class="${view==='month'?'on':''}">Месяц</button></div>
    </div>`;
  M.innerHTML = `<div class="cal">${head}${view === 'month' ? monthHtml() : weekHtml()}</div>`;
  if (view === 'week'){
    const body = M.querySelector('.wk-body');
    // как в Google: сразу прокручиваем к рабочему времени (или к текущему часу)
    const now = new Date(), h = isoOf(now) >= mondayOf(calCursor) && isoOf(now) <= addDays(mondayOf(calCursor), 6) ? Math.max(now.getHours() - 2, 0) : 8;
    body.scrollTop = h * HOUR_PX;
    // шапка и строка «весь день» должны совпадать с сеткой, у которой есть полоса прокрутки
    const sb = body.offsetWidth - body.clientWidth;
    M.querySelectorAll('.wk-head,.wk-allrow').forEach(x => x.style.paddingRight = sb + 'px');
  }
}

function monthHtml(){
  const d = dateOf(calCursor);
  const first = isoOf(new Date(d.getFullYear(), d.getMonth(), 1));
  const start = mondayOf(first);
  const last = isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const weeks = Math.ceil((Math.round((dateOf(last) - dateOf(start)) / 864e5) + 1) / 7);
  const end = addDays(start, weeks * 7 - 1);
  const map = tasksByDay(start, end), td = today(), month = d.getMonth();
  let cells = '';
  for (let i = 0; i < weeks * 7; i++){
    const iso = addDays(start, i), day = dateOf(iso);
    const list = map[iso] || [];
    const shown = list.length > MAX_CHIPS ? list.slice(0, MAX_CHIPS - 1) : list;
    const more = list.length - shown.length;
    const label = day.getDate() === 1 ? `${day.getDate()} ${MONTHS_GEN[day.getMonth()].slice(0, 3)}.` : day.getDate();
    cells += `<div class="mc ${day.getMonth() !== month ? 'other' : ''} ${iso === td ? 'today' : ''} ${day.getDay() % 6 === 0 ? 'weekend' : ''}" data-day="${iso}">
      <div class="mc-num"><span data-calday="${iso}" title="Открыть неделю">${label}</span></div>
      <div class="mc-chips">${shown.map(x => chipHtml(x)).join('')}${more ? `<button class="more" data-more="${iso}">ещё ${more}</button>` : ''}</div>
    </div>`;
  }
  return `<div class="month"><div class="m-dow">${DOW.map(x => `<div>${x}</div>`).join('')}</div>
    <div class="m-grid" style="grid-template-rows:repeat(${weeks},minmax(96px,1fr))">${cells}</div></div>`;
}

function weekHtml(){
  const start = mondayOf(calCursor), end = addDays(start, 6), td = today();
  const map = tasksByDay(start, end);
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const now = new Date(), nowTop = (now.getHours() + now.getMinutes() / 60) * HOUR_PX;
  const headCells = days.map((iso, i) => `<div class="wk-day ${iso === td ? 'today' : ''}"><small>${DOW[i]}</small><span data-calday="${iso}">${dateOf(iso).getDate()}</span></div>`).join('');
  const allDay = days.map(iso => `<div class="wk-all" data-day="${iso}">${(map[iso] || []).filter(x => !x.t.time).map(x => chipHtml(x, 'week')).join('')}</div>`).join('');
  const hours = [...Array(24)].map((_, h) => `<div class="wk-hour"><span>${h ? String(h).padStart(2, '0') + ':00' : ''}</span></div>`).join('');
  const cols = days.map(iso => {
    const events = (map[iso] || []).filter(x => x.t.time).map(({t, p}) => {
      const [hh, mm] = t.time.split(':').map(Number);
      return `<div class="ev pr-bg${t.pr} ${t.status === 'done' ? 'done' : ''}" draggable="true" data-tid="${t.id}" style="top:${(hh + mm / 60) * HOUR_PX}px"
        title="${esc((t.text || 'Без названия') + '\n' + p.icon + ' ' + (p.title || UNTITLED))}"><b>${esc(t.text || 'Без названия')}</b><small>${t.time} · ${picon(p)} ${pname(p)}</small></div>`;
    }).join('');
    return `<div class="wk-col ${iso === td ? 'today' : ''}" data-day="${iso}" data-slots="1">${events}${iso === td ? `<div class="now" style="top:${nowTop}px"></div>` : ''}</div>`;
  }).join('');
  return `<div class="week">
    <div class="wk-head"><div class="wk-gutter"></div>${headCells}</div>
    <div class="wk-allrow"><div class="wk-gutter"><small>весь день</small></div>${allDay}</div>
    <div class="wk-body"><div class="wk-grid" style="height:${24 * HOUR_PX}px"><div class="wk-hours">${hours}</div>${cols}</div></div>
  </div>`;
}

/* ---------- всплывашки ---------- */
function closeCalPop(){ if (calPop){ calPop.remove(); calPop = null; } }
function placePop(pop, anchor){
  M.querySelector('.cal').appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  // рядом с днём: справа, а если не помещается — слева; по вертикали — в пределах окна
  let left = r.right + 8;
  if (left + pw > innerWidth - 8) left = r.left - pw - 8;
  if (left < 8) left = Math.max(8, Math.min(r.left, innerWidth - pw - 8));
  let top = Math.min(r.top, innerHeight - ph - 8);
  pop.style.left = left + 'px'; pop.style.top = Math.max(8, top) + 'px';
  calPop = pop;
}
// Список всех задач дня (по клику на «ещё N»)
function showDayPop(iso, anchor){
  closeCalPop();
  const d = dateOf(iso), list = tasksByDay(iso, iso)[iso] || [];
  const pop = document.createElement('div'); pop.className = 'cal-pop';
  pop.innerHTML = `<div class="cp-head"><small>${DOW[(d.getDay() + 6) % 7]}</small><span class="${iso === today() ? 'today' : ''}">${d.getDate()}</span><button class="iconbtn" data-cal="close">✕</button></div>
    ${list.map(x => chipHtml(x)).join('')}`;
  placePop(pop, anchor);
}
// Быстрое создание задачи на выбранный день (и время)
function showCreatePop(iso, time, anchor){
  closeCalPop();
  const pages = S.pages;
  if (!pages.length){ toast('Сначала создайте страницу — задачи хранятся на страницах'); return; }
  const def = page(S.calPage) ? S.calPage : pages[0].id;
  const d = dateOf(iso);
  const pop = document.createElement('div'); pop.className = 'cal-pop create';
  pop.innerHTML = `<input class="cp-title" placeholder="Название задачи" spellcheck="false">
    <div class="cp-when">🕒 ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${DOW[(d.getDay() + 6) % 7].toLowerCase()}${time ? ', ' + time : ''}</div>
    <select class="cp-page">${pageOptions(def)}</select>
    <div class="cp-foot"><button class="cal-btn" data-cal="close">Отмена</button><button class="cal-btn ok" data-cal="create">Сохранить</button></div>`;
  pop.dataset.day = iso; pop.dataset.time = time || '';
  placePop(pop, anchor);
  pop.querySelector('.cp-title').focus();
}
function createFromPop(){
  const pop = calPop; if (!pop) return;
  const text = pop.querySelector('.cp-title').value.trim();
  if (!text){ pop.querySelector('.cp-title').focus(); return; }
  const pid = pop.querySelector('.cp-page').value;
  S.calPage = pid;
  page(pid).tasks.push({id:uid(), text, status:'todo', due:pop.dataset.day, time:pop.dataset.time, pr:3, remind:'', desc:'', subs:[]});
  save(); render();
  toast(`Задача добавлена на страницу «${page(pid).title || UNTITLED}»`);
}

/* ---------- события ---------- */
function calShift(dir){
  if (calView() === 'month'){ const d = dateOf(calCursor); calCursor = isoOf(new Date(d.getFullYear(), d.getMonth() + dir, 1)); }
  else calCursor = addDays(calCursor, 7 * dir);
  renderCalendar();
}
// Время по вертикальной позиции в колонке недели (с шагом 30 минут)
function slotTime(col, clientY){
  const y = clientY - col.getBoundingClientRect().top;
  const mins = Math.min(23 * 60 + 30, Math.max(0, Math.floor(y / HOUR_PX * 2) * 30));
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

M.addEventListener('click', e => {
  if (S.sel !== '@cal') return;
  const el = e.target;
  const btn = el.closest('[data-cal],[data-calview],[data-calday],[data-more]');
  if (btn){
    e.stopPropagation();
    const a = btn.dataset.cal;
    if (a === 'today'){ calCursor = today(); renderCalendar(); }
    if (a === 'prev') calShift(-1);
    if (a === 'next') calShift(1);
    if (a === 'close') closeCalPop();
    if (a === 'create') createFromPop();
    if (btn.dataset.calview){ S.calView = btn.dataset.calview; save(); renderCalendar(); }
    if (btn.dataset.calday){ calCursor = btn.dataset.calday; S.calView = 'week'; save(); renderCalendar(); }
    if (btn.dataset.more) showDayPop(btn.dataset.more, btn.closest('.mc'));
    return;
  }
  if (el.closest('.cal-pop')) return; // клики внутри всплывашки (кроме задач) не трогаем
  if (el.closest('[data-tid]')) return; // клик по задаче откроет панель (обработчик в app.js)
  // клик по пустому месту дня — быстрое создание задачи
  const cell = el.closest('.mc,.wk-all,.wk-col');
  if (cell){
    const time = cell.classList.contains('wk-col') ? slotTime(cell, e.clientY) : '';
    let anchor = cell;
    if (time){ // в виде «Неделя» показываем всплывашку у выбранного часа
      const mark = document.createElement('div'); mark.className = 'ev ghost';
      const [hh, mm] = time.split(':').map(Number); mark.style.top = (hh + mm / 60) * HOUR_PX + 'px';
      mark.textContent = time; cell.appendChild(mark); anchor = mark;
    }
    showCreatePop(cell.dataset.day, time, anchor);
    return;
  }
  closeCalPop();
}, true);

M.addEventListener('keydown', e => {
  if (!calPop) return;
  if (e.key === 'Enter' && e.target.classList.contains('cp-title')){ e.preventDefault(); createFromPop(); }
  if (e.key === 'Escape'){ e.stopPropagation(); closeCalPop(); M.querySelectorAll('.ev.ghost').forEach(x => x.remove()); }
});

/* перетаскивание задач между днями (и часами в виде «Неделя») */
let calDrag = null;
M.addEventListener('dragstart', e => {
  const c = e.target.closest('.chip,.ev'); if (!c || S.sel !== '@cal') return;
  closeCalPop();
  calDrag = c.dataset.tid; c.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', calDrag);
});
M.addEventListener('dragend', () => { calDrag = null; M.querySelectorAll('.dragging,.drop-day').forEach(x => x.classList.remove('dragging', 'drop-day')); });
M.addEventListener('dragover', e => {
  if (!calDrag) return;
  const cell = e.target.closest('.mc,.wk-all,.wk-col'); if (!cell) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  M.querySelectorAll('.drop-day').forEach(x => x !== cell && x.classList.remove('drop-day'));
  cell.classList.add('drop-day');
});
M.addEventListener('drop', e => {
  if (!calDrag) return;
  const cell = e.target.closest('.mc,.wk-all,.wk-col'); if (!cell) return;
  e.preventDefault();
  const [, t] = findTask(calDrag); if (!t) return;
  t.due = cell.dataset.day;
  if (cell.classList.contains('wk-col')) t.time = slotTime(cell, e.clientY);
  if (cell.classList.contains('wk-all')) t.time = '';
  delete t.reminded;
  calDrag = null; save(); render();
});
