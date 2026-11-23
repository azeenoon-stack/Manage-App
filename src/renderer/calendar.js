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

const LANE_PX = 22;  // высота строки с плашкой (20 px плашка + 2 px зазор)
const MONTH_TOP = 31; // отступ плашек от верха клетки месяца (под номером дня)

// Внутри дня: сначала без времени, потом по времени, потом по приоритету
const dayOrder = (a, b) => (a.t.time ? 1 : 0) - (b.t.time ? 1 : 0) || (a.t.time||'').localeCompare(b.t.time||'') || a.t.pr - b.t.pr;

// Задачи, которые хотя бы одним днём попадают в период [from, to]
function tasksIn(from, to){
  return allTasks().filter(({t}) => t.due && t.due <= to && endOf(t) >= from);
}

// Задачи по дням: { 'ГГГГ-ММ-ДД': [{t, p}, …] }. Многодневная задача есть в каждом своём дне.
function tasksByDay(from, to){
  const map = {};
  for (const x of tasksIn(from, to)){
    const last = endOf(x.t) > to ? to : endOf(x.t);
    for (let d = x.t.due < from ? from : x.t.due; d <= last; d = addDays(d, 1)) (map[d] ||= []).push(x);
  }
  for (const k in map) map[k].sort((a, b) => isMulti(b.t) - isMulti(a.t) || dayOrder(a, b));
  return map;
}

// Раскладка задач недели по строкам, как в Google Календаре: каждая задача занимает
// колонки c0..c1 (0 — понедельник) и первую строку, свободную во всех этих днях.
// Многодневные идут первыми (более длинные — выше), затем однодневные.
function layoutWeek(start, items){
  const rows = items.map(x => ({x, c0: Math.max(0, daysBetween(start, x.t.due)), c1: Math.min(6, daysBetween(start, endOf(x.t)))}));
  rows.sort((p, q) => isMulti(q.x.t) - isMulti(p.x.t) || p.c0 - q.c0 || (q.c1 - q.c0) - (p.c1 - p.c0) || dayOrder(p.x, q.x));
  const busy = [...Array(7)].map(() => []);
  for (const r of rows){
    let lane = 0;
    const free = l => { for (let c = r.c0; c <= r.c1; c++) if (busy[c][l]) return false; return true; };
    while (!free(lane)) lane++;
    for (let c = r.c0; c <= r.c1; c++) busy[c][lane] = true;
    r.lane = lane;
  }
  return rows;
}

/* ---------- отрисовка ---------- */
function taskTip({t, p}){
  const when = isMulti(t) ? fmtRange(t) : (t.time || '');
  return esc(`${t.text || 'Без названия'}\n${p.icon} ${p.title || UNTITLED}${when ? '\n' + when : ''}`);
}
function chipHtml({t, p}, mode = 'month'){
  const done = t.status === 'done' ? 'done' : '';
  // любая задача — цветная плашка цвета приоритета; у задач со временем время стоит перед названием
  const time = mode === 'month' && t.time ? `<b>${t.time}</b>` : '';
  const range = isMulti(t) ? `<b>${esc(fmtRange(t))}</b>` : '';
  return `<div class="chip allday pr-bg${t.pr} ${done}" draggable="true" data-tid="${t.id}" title="${taskTip({t, p})}">${time}<span>${esc(t.text || 'Без названия')}</span>${range}</div>`;
}
// Плашка в раскладке недели: растягивается на дни c0..c1. Если задача началась раньше этой
// недели или продолжается после неё, у плашки «обрезан» край — как в Google.
function barHtml(r, weekStart, top0, mode){
  const {x: {t, p}, c0, c1, lane} = r;
  const cutL = t.due < addDays(weekStart, c0), cutR = endOf(t) > addDays(weekStart, c1);
  const padL = cutL ? 0 : 3, padR = cutR ? 0 : 4;
  const cols = c1 - c0 + 1;
  const style = `left:calc(${c0} * 100% / 7 + ${padL}px);width:calc(${cols} * 100% / 7 - ${padL + padR}px);top:${top0 + lane * LANE_PX}px`;
  const time = mode === 'month' && t.time ? `<b>${t.time}</b>` : '';
  return `<div class="chip allday bar pr-bg${t.pr} ${t.status === 'done' ? 'done' : ''} ${cutL ? 'cut-l' : ''} ${cutR ? 'cut-r' : ''}"
    draggable="true" data-tid="${t.id}" data-day0="${addDays(weekStart, c0)}" data-cols="${cols}" style="${style}" title="${taskTip({t, p})}">${time}<span>${esc(t.text || 'Без названия')}</span></div>`;
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
  const weeks = Math.ceil((daysBetween(start, last) + 1) / 7);
  const td = today(), month = d.getMonth();
  let html = '';
  for (let w = 0; w < weeks; w++){
    const ws = addDays(start, w * 7);
    let cells = '';
    for (let i = 0; i < 7; i++){
      const iso = addDays(ws, i), day = dateOf(iso);
      const label = day.getDate() === 1 ? `${day.getDate()} ${MONTHS_GEN[day.getMonth()].slice(0, 3)}.` : day.getDate();
      cells += `<div class="mc ${day.getMonth() !== month ? 'other' : ''} ${iso === td ? 'today' : ''} ${day.getDay() % 6 === 0 ? 'weekend' : ''}" data-day="${iso}">
        <div class="mc-num"><span data-calday="${iso}" title="Открыть неделю">${label}</span></div></div>`;
    }
    // в клетке помещается MAX_CHIPS строк; если задач больше — последняя строка отдаётся под «ещё N»
    const rows = layoutWeek(ws, tasksIn(ws, addDays(ws, 6)));
    const total = Array(7).fill(0), shown = Array(7).fill(0), used = Array(7).fill(0);
    for (const r of rows) for (let c = r.c0; c <= r.c1; c++) total[c]++;
    const lim = total.map(n => n > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS);
    let bars = '';
    for (const r of rows){
      let fits = true;
      for (let c = r.c0; c <= r.c1; c++) if (r.lane >= lim[c]) fits = false;
      if (!fits) continue;
      for (let c = r.c0; c <= r.c1; c++){ shown[c]++; used[c] = Math.max(used[c], r.lane + 1); }
      bars += barHtml(r, ws, MONTH_TOP, 'month');
    }
    for (let c = 0; c < 7; c++){
      const more = total[c] - shown[c];
      if (more) bars += `<button class="more" data-more="${addDays(ws, c)}" style="left:calc(${c} * 100% / 7 + 3px);width:calc(100% / 7 - 7px);top:${MONTH_TOP + Math.min(used[c], MAX_CHIPS - 1) * LANE_PX}px">ещё ${more}</button>`;
    }
    html += `<div class="m-week">${cells}<div class="m-bars">${bars}</div></div>`;
  }
  return `<div class="month"><div class="m-dow">${DOW.map(x => `<div>${x}</div>`).join('')}</div>
    <div class="m-grid">${html}</div></div>`;
}

function weekHtml(){
  const start = mondayOf(calCursor), end = addDays(start, 6), td = today();
  const map = tasksByDay(start, end);
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const now = new Date(), nowTop = (now.getHours() + now.getMinutes() / 60) * HOUR_PX;
  const headCells = days.map((iso, i) => `<div class="wk-day ${iso === td ? 'today' : ''}"><small>${DOW[i]}</small><span data-calday="${iso}">${dateOf(iso).getDate()}</span></div>`).join('');
  // строка «весь день»: задачи без времени и все многодневные (полосой через дни)
  const allRows = layoutWeek(start, tasksIn(start, end).filter(({t}) => isMulti(t) || !t.time));
  const lanes = Math.max(1, ...allRows.map(r => r.lane + 1));
  const allDay = days.map((iso, i) => `<div class="wk-all" data-day="${iso}" style="grid-column:${i + 2}"></div>`).join('')
    + `<div class="wk-allbars" style="height:${lanes * LANE_PX + 6}px">${allRows.map(r => barHtml(r, start, 3, 'week')).join('')}</div>`;
  const hours = [...Array(24)].map((_, h) => `<div class="wk-hour"><span>${h ? String(h).padStart(2, '0') + ':00' : ''}</span></div>`).join('');
  const cols = days.map(iso => {
    const events = (map[iso] || []).filter(x => x.t.time && !isMulti(x.t)).map(({t, p}) => {
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
    <label class="cp-end">до <input type="date" min="${iso}" title="Последний день — для задач на несколько дней (необязательно)"></label>
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
  const end = pop.querySelector('.cp-end input').value;
  const due = pop.dataset.day;
  page(pid).tasks.push({id:uid(), text, status:'todo', due, end: end > due && validDate(end) ? end : '', time:pop.dataset.time, pr:3, remind:'', desc:'', subs:[]});
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
    if (btn.dataset.more) showDayPop(btn.dataset.more, M.querySelector(`.mc[data-day="${btn.dataset.more}"]`));
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
let calDragOff = 0; // за какой день полосы взяли задачу (0 — за первый)
M.addEventListener('dragstart', e => {
  const c = e.target.closest('.chip,.ev'); if (!c || S.sel !== '@cal') return;
  closeCalPop();
  calDrag = c.dataset.tid; c.classList.add('dragging');
  calDragOff = 0;
  const [, t] = findTask(calDrag);
  if (t && c.dataset.day0){
    // многодневную полосу можно взять за середину — тогда сдвигаем так, чтобы этот день попал под курсор
    const r = c.getBoundingClientRect(), cols = +c.dataset.cols;
    const k = Math.min(cols - 1, Math.max(0, Math.floor((e.clientX - r.left) / (r.width / cols))));
    calDragOff = daysBetween(t.due, addDays(c.dataset.day0, k));
  }
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', calDrag);
  // пока тащим, плашки не мешают навести курсор на клетку дня под ними
  setTimeout(() => M.querySelector('.cal')?.classList.add('dnd'), 0);
});
M.addEventListener('dragend', () => { calDrag = null; M.querySelector('.cal')?.classList.remove('dnd'); M.querySelectorAll('.dragging,.drop-day').forEach(x => x.classList.remove('dragging', 'drop-day')); });
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
  setDue(t, addDays(cell.dataset.day, -calDragOff));
  if (cell.classList.contains('wk-col')) t.time = slotTime(cell, e.clientY);
  if (cell.classList.contains('wk-all')) t.time = '';
  delete t.reminded;
  calDrag = null; save(); render();
});
