/* ===== 播放器（含倍速、连播、随机、续播） ===== */
const audio = new Audio();
audio.preload = 'metadata';
const SPEEDS = [1, 0.8, 1.25, 1.5];
let speedIdx = 0;
let posSaveClock = 0;
const POS_KEY = 'bs-positions';

function loadPositions() {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}'); } catch (e) { return {}; }
}
function writePositions(p) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) {}
}
function savePosition(id, t) {
  if (t < 3) return;
  const p = loadPositions(); p[id] = t; writePositions(p);
}
function clearPosition(id) {
  const p = loadPositions();
  if (p[id] != null) { delete p[id]; writePositions(p); }
}

function playStory(id, fromStart) {
  const s = state.stories.find(x => x.id === id);
  if (!s) return;
  state.currentId = id;
  audio.src = getUrl(s);
  audio.playbackRate = SPEEDS[speedIdx];
  if (!fromStart) {
    const pos = loadPositions()[id];
    if (pos && pos > 2 && pos < (s.duration || 0) - 3) {
      audio.currentTime = pos;
    }
  }
  const p = audio.play();
  if (p && p.catch) p.catch(() => toast('暂时无法播放'));
  $('#playerBar').hidden = false;
  $('#playerTitle').textContent = s.title || '未命名故事';
  syncPlayerUI();
  renderStories();
}

function pausePlayback() {
  audio.pause();
}
function togglePlay() {
  if (audio.paused) {
    if (!audio.src && state.stories.length) { playStory(state.stories[0].id); return; }
    const p = audio.play(); if (p && p.catch) p.catch(() => {});
  } else {
    audio.pause();
  }
}

function stopToEnd() {
  if (state.currentId) { clearPosition(state.currentId); }
  state.currentId = null;
  audio.pause();
  audio.removeAttribute('src'); audio.load();
  $('#playerBar').hidden = true;
  $('#progressFill').style.width = '0%';
  renderStories();
}

function playNext(fromId) {
  let list = visibleStories();
  if (!list.length) { stopToEnd(); return; }
  if (state.shuffle) {
    const others = list.filter(s => s.id !== fromId);
    if (others.length) { playStory(others[Math.floor(Math.random() * others.length)].id); return; }
    stopToEnd(); return;
  }
  const idx = list.findIndex(s => s.id === fromId);
  if (idx >= 0 && idx < list.length - 1) playStory(list[idx + 1].id);
  else stopToEnd();
}

function cycleSpeed() {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  audio.playbackRate = SPEEDS[speedIdx];
  syncPlayerUI();
}

function syncPlayerUI() {
  const bar = $('#playerBar');
  const cur = state.stories.find(s => s.id === state.currentId);
  if (!cur) { bar.hidden = true; return; }
  $('#playerTitle').textContent = cur.title || '未命名故事';
  $('#playerPlay').innerHTML = audio.paused ? ICON.play : ICON.pause;
  $('#speedBtn').textContent = SPEEDS[speedIdx] + '×';
  const fav = $('#favBtn');
  fav.classList.toggle('is-on', !!cur.favorite);
}

function seekFromEvent(e) {
  if (!state.currentId || !isFinite(audio.duration)) return;
  const bar = $('#progressBar');
  const r = bar.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
  const ratio = Math.min(1, Math.max(0, x / r.width));
  audio.currentTime = ratio * audio.duration;
  $('#progressFill').style.width = (ratio * 100) + '%';
}

audio.addEventListener('loadedmetadata', () => {
  $('#playerDur').textContent = fmtClock(audio.duration);
});
audio.addEventListener('play', () => { syncPlayerUI(); renderStories(); });
audio.addEventListener('pause', () => { syncPlayerUI(); renderStories(); });
audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime || 0;
  $('#playerCur').textContent = fmtClock(t);
  if (isFinite(audio.duration) && audio.duration > 0) {
    $('#progressFill').style.width = (t / audio.duration * 100) + '%';
  }
  const now = Math.floor(t);
  if (now > 0 && now - posSaveClock >= 5) {
    posSaveClock = now;
    if (state.currentId) savePosition(state.currentId, t);
  }
});
audio.addEventListener('ended', () => {
  const id = state.currentId;
  if (id) clearPosition(id);
  playNext(id);
});
