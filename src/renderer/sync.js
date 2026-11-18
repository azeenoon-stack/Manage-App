'use strict';
/* Синхронизация в интерфейсе: применение изменений с сервера, значок состояния и окно настроек.
   Сама связь с сервером — в главном процессе (src/sync.js). */

/* ---------- изменения с сервера ---------- */
let remoteMsg = null; // последняя присланная версия данных { rev, data }

window.api.onRemote(m => { remoteMsg = m; applyRemote(); });

// Пользователь что-то печатает — перерисовка сбила бы курсор, поэтому подождём
function isEditing(){
  if (editingField && editingField.isConnected) return true;
  const a = document.activeElement;
  if (!a || a === document.body || a.closest('.modal,.pal-wrap')) return false;
  return a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA';
}

function applyRemote(){
  if (!remoteMsg || !S) return;
  if (savesInFlight > 0) return;                    // дождёмся ответа на своё сохранение
  if (saveT !== null && !noSave){ flush(); return; } // сначала отправим свои правки — главный процесс пришлёт итог
  if (isEditing()) return;                          // применим, когда фокус уйдёт из поля
  const m = remoteMsg; remoteMsg = null;
  let d;
  try { d = migrate(m.data); } catch(e){ console.error('Данные с сервера не применены:', e); return; }
  S.pages = d.pages;
  baseRev = m.rev;
  render();
  syncReminders();
}
document.addEventListener('focusout', () => setTimeout(applyRemote, 0));

/* ---------- значок состояния ---------- */
const SYNC_TEXT = {
  off: 'выключена',
  connecting: 'подключение…',
  online: 'включена, всё синхронизировано',
  offline: 'нет связи с сервером',
  error: 'ошибка',
};
let syncSt = {state:'off'};

function syncStatusText(st){
  let s = SYNC_TEXT[st.state] || st.state;
  if (st.state === 'error' && st.msg) s += ': ' + st.msg;
  if (st.at && (st.state === 'online' || st.state === 'offline')) s += `\nПоследний обмен: ${new Date(st.at).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})}`;
  return s;
}

function paintSync(){
  const b = $('#syncBtn');
  b.dataset.state = syncSt.state;
  b.title = 'Синхронизация: ' + syncStatusText(syncSt);
  const el = document.getElementById('syStat');
  if (el) el.innerHTML = `<i data-state="${syncSt.state}"></i><span>${esc(syncStatusText(syncSt))}</span>`;
}

window.api.onSyncStatus(st => { syncSt = st; paintSync(); });
window.api.syncGet().then(c => { syncSt = c.status; paintSync(); });
$('#syncBtn').onclick = () => openSyncDialog();

/* ---------- окно настроек ---------- */
async function openSyncDialog(){
  if (document.querySelector('.sync-dlg')) return;
  const c = await window.api.syncGet();
  syncSt = c.status;
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div role="dialog" class="sync-dlg" aria-label="Синхронизация">
    <h3>Синхронизация</h3>
    <p class="hint">Задачи и заметки синхронизируются между вашими компьютерами через ваш сервер. Без связи всё работает как обычно — изменения отправятся, когда сервер снова будет доступен.</p>
    <label>Адрес сервера<input id="syUrl" spellcheck="false" placeholder="например, 203.0.113.5:8443" value="${esc(c.url)}"></label>
    <label>Ключ доступа<input id="syTok" type="password" spellcheck="false" placeholder="${c.hasToken ? 'сохранён — оставьте пустым, чтобы не менять' : 'вставьте ключ'}"></label>
    ${c.enabled ? '' : `<label class="sy-chk"><input type="checkbox" id="syRep"><span><b>Заменить данные на этом компьютере данными с сервера</b><br>
      Отметьте на втором компьютере, если на сервере уже есть ваши задачи. Без отметки данные этого компьютера и сервера объединятся.</span></label>`}
    <div class="sy-st" id="syStat"></div>
    <div class="sy-err" id="syErr"></div>
    <nav>
      ${c.enabled ? '<button data-a="off">Отключить</button>' : ''}
      <span class="sp"></span>
      <button data-a="close">Закрыть</button>
      <button class="ok" data-a="on">${c.enabled ? 'Сохранить' : 'Подключить'}</button>
    </nav>
  </div>`;
  const close = () => { m.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => {
    if (e.key === 'Escape'){ e.stopPropagation(); close(); }
    if (e.key === 'Enter' && e.target.tagName === 'INPUT'){ e.preventDefault(); m.querySelector('[data-a=on]').click(); }
  };
  const err = text => { m.querySelector('#syErr').textContent = text || ''; };
  m.onclick = async e => {
    if (e.target === m){ close(); return; }
    const a = e.target.dataset.a; if (!a) return;
    if (a === 'close'){ close(); return; }
    try {
      if (a === 'off'){
        await window.api.syncSet({enabled:false});
        close(); toast('Синхронизация отключена');
        return;
      }
      const url = m.querySelector('#syUrl').value.trim();
      const token = m.querySelector('#syTok').value.trim();
      if (!url){ err('Укажите адрес сервера'); return; }
      if (!token && !c.hasToken){ err('Укажите ключ доступа'); return; }
      const replace = !!m.querySelector('#syRep')?.checked;
      if (replace && !await ask('Задачи и заметки на этом компьютере будут заменены данными с сервера. Продолжить?', 'Заменить')) return;
      flush();
      const r = await window.api.syncSet({url, token, enabled:true, replace});
      syncSt = r.status; err('');
      close(); toast('Синхронизация включена');
    } catch(ex){
      err(String(ex.message || ex).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(m);
  paintSync();
  (c.url ? m.querySelector('#syTok') : m.querySelector('#syUrl')).focus();
}
