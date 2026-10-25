/* ===== 弹窗：保存故事 + 定时 ===== */
function openSaveModal() {
  const p = state.pending;
  if (!p) return;
  $('#previewAudio').src = p.url;
  const now = new Date();
  const n = state.stories.length + 1;
  $('#storyTitle').value = `第 ${n} 夜 · ${now.getMonth() + 1}月${now.getDate()}日`;
  $('#storyNote').value = '';
  $('#saveMask').hidden = false;
}
function closeSaveModal() { $('#saveMask').hidden = true; }

$('#rerecordBtn').addEventListener('click', () => {
  const pa = $('#previewAudio');
  try { pa.pause(); } catch (e) {}
  if (state.pending) { URL.revokeObjectURL(state.pending.url); state.pending = null; }
  closeSaveModal();
  toast('已放弃，准备录下一段');
});

$('#saveStoryBtn').addEventListener('click', async () => {
  if (!state.pending) return;
  const p = state.pending;
  const now = new Date();
  const n = state.stories.length + 1;
  const def = `第 ${n} 夜 · ${now.getMonth() + 1}月${now.getDate()}日`;
  const title = $('#storyTitle').value.trim() || def;
  const note = $('#storyNote').value.trim();
  const story = {
    id: uid(), title, note,
    blob: p.blob, mime: p.mime, duration: p.duration,
    createdAt: Date.now(), favorite: false
  };
  try { await dbAdd(story); } catch (e) { toast('保存失败：浏览器存储不可用'); return; }
  try { $('#previewAudio').pause(); } catch (e) {}
  URL.revokeObjectURL(p.url);
  state.pending = null;
  state.stories.push(story);
  state.stories.sort((a, b) => b.createdAt - a.createdAt);
  closeSaveModal();
  renderStories(); updateStats();
  toast('已收进故事库，晚安');
});

function openTimerModal() {
  $('#timerCurrent').textContent = timerRemain > 0
    ? `已设定：还剩 ${Math.ceil(timerRemain / 60)} 分钟，到点自动停止`
    : '到时间会自动停止播放并进入休眠';
  $$('#timerOpts .opt').forEach(b =>
    b.classList.toggle('is-on', timerRemain > 0 && Number(b.dataset.mins) * 60 === timerRemain));
  $('#timerMask').hidden = false;
}
function closeTimerModal() { $('#timerMask').hidden = true; }
