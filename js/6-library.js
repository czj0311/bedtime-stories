/* ===== 故事库渲染 ===== */
const ICON = {
  play: '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
  fav: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 20s-7-4.3-7-9.5C5 7.5 7 5.5 9.5 5.5c1.4 0 2.6.8 2.5 1.6C12.9 6.3 13.1 5.5 14.5 5.5 17 5.5 19 7.5 19 10.5 19 15.7 12 20 12 20z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>',
  download: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  trash: '<svg viewBox="0 0 24 24" class="ic"><path d="M5 7h14M10 7V5h4v2M8 7l1 13h6l1-13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
};

const _urlCache = {};
function getUrl(story) {
  if (story.blob && !_urlCache[story.id]) _urlCache[story.id] = URL.createObjectURL(story.blob);
  return _urlCache[story.id];
}

function visibleStories() {
  let list = state.stories;
  if (state.filter === 'fav') list = list.filter(s => s.favorite);
  const q = state.search.trim().toLowerCase();
  if (q) list = list.filter(s =>
    (s.title || '').toLowerCase().includes(q) || (s.note || '').toLowerCase().includes(q));
  return list;
}

function renderStories() {
  const wrap = $('#storyList');
  const list = visibleStories();
  const showEmpty = state.stories.length === 0;
  $('#emptyState').hidden = !showEmpty;
  wrap.style.display = list.length ? '' : 'none';
  wrap.innerHTML = list.map(s => {
    const playing = state.currentId === s.id;
    const note = s.note ? `<div class="story-note">${esc(s.note)}</div>` : '';
    return `
      <div class="story-item${playing ? ' is-playing' : ''}" data-id="${s.id}">
        <button class="story-play" data-action="play" aria-label="播放">${playing ? ICON.pause : ICON.play}</button>
        <div class="story-info">
          <div class="story-name">${esc(s.title || '未命名故事')}</div>
          <div class="story-meta">${fmtDate(s.createdAt)} · ${fmtDur(s.duration)}</div>
          ${note}
        </div>
        <div class="story-ops">
          <button class="ops-btn fav${s.favorite ? ' is-on' : ''}" data-action="fav" aria-label="收藏">${ICON.fav}</button>
          <button class="ops-btn" data-action="download" aria-label="下载">${ICON.download}</button>
          <button class="ops-btn" data-action="delete" aria-label="删除">${ICON.trash}</button>
        </div>
      </div>`;
  }).join('');
}

function updateStats() {
  const n = state.stories.length;
  const total = state.stories.reduce((a, s) => a + (s.duration || 0), 0);
  const el = $('#stats');
  if (!n) { el.textContent = '还没有故事 · 今晚录第一个吧'; return; }
  const mins = Math.round(total / 60);
  el.textContent = `共 ${n} 夜故事 · ${mins > 0 ? mins + ' 分钟' : '不足 1 分钟'}的声音`;
}

async function toggleFav(id) {
  const s = state.stories.find(x => x.id === id);
  if (!s) return;
  s.favorite = !s.favorite;
  try { await dbPut(s); } catch (e) {}
  renderStories();
  syncPlayerUI();
  toast(s.favorite ? '已收藏' : '已取消收藏');
}

function downloadStory(id) {
  const s = state.stories.find(x => x.id === id);
  if (!s) return;
  const url = getUrl(s);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${s.title || '晚安故事'}.${extFor(s.mime)}`;
  document.body.appendChild(a); a.click(); a.remove();
  toast('已开始下载，记得备份');
}

async function deleteStory(id) {
  const s = state.stories.find(x => x.id === id);
  if (!s) return;
  if (!confirm(`确定删除「${s.title || '这个故事'}」吗？此操作不可恢复。`)) return;
  if (state.currentId === id) { pausePlayback(); audio.removeAttribute('src'); audio.load(); state.currentId = null; }
  try { await dbDelete(id); } catch (e) {}
  if (_urlCache[id]) { URL.revokeObjectURL(_urlCache[id]); delete _urlCache[id]; }
  state.stories = state.stories.filter(x => x.id !== id);
  renderStories(); updateStats(); syncPlayerUI();
  toast('已删除');
}
