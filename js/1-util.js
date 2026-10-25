/* ===== 工具函数 + IndexedDB ===== */
const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => Array.from(ctx.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');

// 秒 -> 00:00
const fmtClock = sec => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};
// 秒 -> 中文时长
const fmtDur = sec => {
  sec = Math.floor(sec || 0);
  if (sec < 60) return sec + ' 秒';
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
};
// 时间戳 -> 月日
const fmtDate = ts => {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (isYest) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sameYear ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','&#039;':'&#039;'}[c]));

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ===== IndexedDB ===== */
const DB_NAME = 'bedtime-stories', STORE = 'stories', DB_VER = 1;
let _dbPromise = null;
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}
function txDone(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbAdd(story) {
  const db = await openDB();
  return txDone(db.transaction(STORE, 'readwrite').objectStore(STORE).add(story));
}
async function dbPut(story) {
  const db = await openDB();
  return txDone(db.transaction(STORE, 'readwrite').objectStore(STORE).put(story));
}
async function dbDelete(id) {
  const db = await openDB();
  return txDone(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
}
async function dbAll() {
  const db = await openDB();
  return txDone(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
}
