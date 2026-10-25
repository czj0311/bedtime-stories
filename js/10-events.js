/* ===== 全局事件绑定 + 初始化 + PWA ===== */
function paintVolume(el) {
  const v = el.value;
  el.style.background = `linear-gradient(90deg,var(--gold) 0%,var(--gold) ${v}%,rgba(255,255,255,.12) ${v}%)`;
}

// 录音
$('#recBtn').addEventListener('click', startRecording);
$('#pauseBtn').addEventListener('click', () => {
  if (rec.mode === 'recording') pauseRecording();
  else if (rec.mode === 'paused') resumeRecording();
});
$('#discardBtn').addEventListener('click', () => {
  if (rec.mode !== 'idle') stopRecording(true);
});

// 白噪音
$$('.amb-btn').forEach(b => {
  b.addEventListener('click', () => startAmbient(b.dataset.kind));
});
$('#ambVolume').addEventListener('input', e => {
  setAmbientVolume(Number(e.target.value) / 100);
  paintVolume(e.target);
});

// 定时
$('#timerBtn').addEventListener('click', openTimerModal);
$$('#timerOpts .opt').forEach(b => {
  b.addEventListener('click', () => {
    armTimer(Number(b.dataset.mins));
    closeTimerModal();
    toast(`已设定 ${b.dataset.mins} 分钟后停止`);
  });
});
$('#customSet').addEventListener('click', () => {
  const v = Number($('#customTimer').value);
  if (!v || v < 1 || v > 600) { toast('请输入 1-600 分钟'); return; }
  armTimer(v);
  closeTimerModal();
  toast(`已设定 ${v} 分钟后停止`);
});
$('#cancelTimer').addEventListener('click', () => {
  cancelTimer();
  closeTimerModal();
  toast('已取消定时');
});
$('#closeTimer').addEventListener('click', closeTimerModal);
$('#timerMask').addEventListener('click', e => {
  if (e.target === $('#timerMask')) closeTimerModal();
});
$('#sleepVeil').addEventListener('click', wakeSleep);

// 筛选 / 随机 / 搜索
$$('.seg-btn').forEach(b => {
  b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    $$('.seg-btn').forEach(x => x.classList.toggle('is-on', x === b));
    renderStories();
  });
});
$('#shuffleBtn').addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  $('#shuffleBtn').classList.toggle('is-on', state.shuffle);
  $('#shuffleBtn').style.color = state.shuffle ? 'var(--gold)' : '';
  toast(state.shuffle ? '随机播放已开启' : '随机播放已关闭');
});
$('#searchInput').addEventListener('input', e => {
  state.search = e.target.value;
  renderStories();
});

// 故事列表（事件委托）
$('#storyList').addEventListener('click', e => {
  const item = e.target.closest('.story-item');
  if (!item) return;
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = item.dataset.id;
  const action = btn.dataset.action;
  if (action === 'play') {
    if (id === state.currentId) togglePlay(); else playStory(id);
  } else if (action === 'fav') toggleFav(id);
  else if (action === 'download') downloadStory(id);
  else if (action === 'delete') deleteStory(id);
});

// 播放器
$('#playerPlay').addEventListener('click', togglePlay);
$('#speedBtn').addEventListener('click', cycleSpeed);
$('#favBtn').addEventListener('click', () => {
  if (state.currentId) toggleFav(state.currentId);
});
$('#progressBar').addEventListener('click', seekFromEvent);

// 键盘
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeTimerModal();
});

// 初始化
async function init() {
  paintVolume($('#ambVolume'));
  try {
    const all = await dbAll();
    state.stories = (all || []).sort((a, b) => b.createdAt - a.createdAt);
  } catch (e) { state.stories = []; }
  renderStories(); updateStats(); updateRecUI(); setTimerBtn();
}
init();

// PWA：仅在 http(s) 下注入 manifest 并注册 Service Worker（file:// 会被拦截）
if (location.protocol.startsWith('http')) {
  const link = document.createElement('link');
  link.rel = 'manifest'; link.href = 'manifest.webmanifest';
  document.head.appendChild(link);
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}
