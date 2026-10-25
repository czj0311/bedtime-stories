/* ===== 故事库渲染 ===== */
const ICON = {
  play: '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
  mic: '<svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="13" rx="3" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 20s-7-4.3-7-9.5C5 7.5 7 5.5 9.5 5.5c1.4 0 2.6.8 2.5 1.6C12.9 6.3 13.1 5.5 14.5 5.5 17 5.5 19 7.5 19 10.5 19 15.7 12 20 12 20z" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linejoin="round"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 20s-7-4.3-7-9.5C5 7.5 7 5.5 9.5 5.5c1.4 0 2.6.8 2.5 1.6C12.9 6.3 13.1 5.5 14.5 5.5 17 5.5 19 7.5 19 10.5 19 15.7 12 20 12 20z" fill="currentColor"/></svg>',
  download: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  trash: '<svg viewBox="0 0 24 24" class="ic"><path d="M5 7h14M10 7V5h4v2M8 7l1 13h6l1-13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
};
const _urlCache = {};
function getUrl(s) {
  if (!_urlCache[s.id]) _urlCache[s.id] = URL.createObjectURL(s.blob);
  return _urlCache[s.id];
}

function visibleStories() {
  const q = state.search.trim().toLowerCase();
  return state.stories.filter(s => {
    if (state.filter === 'fav' && !s.favorite) return false;
    if (q) {
      const hay = (s.title + ' ' + (s.note || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderStories() {
  const list = $('#storyList');
  const empty = $('#emptyState');
  const items = visibleStories();
  if (!items.length) {
    list.innerHTML = '';
    empty.hidden = false;
    if (state.stories.length && (state.filter === 'fav' || state.search.trim())) {
      empty.querySelector('.empty-title').textContent = '没有找到匹配的故事';
      empty.querySelector('.empty-sub').textContent = '换个关键词，或看看全部故事';
    } else {
      empty.querySelector('.empty-title').textContent = '今晚还没有故事';
      empty.querySelector('.empty-sub').textContent = '轻点上方按钮，把今晚的故事录下来';
    }
    return;
  }
  empty.hidden = true;
  list.innerHTML = items.map(s => {
    const now = s.id === state.currentId;
    const fav = s.favorite ? ICON.heartFill : ICON.heart;
    const coverIcon = now ? (audio.paused ? ICON.play : ICON.pause) : ICON.mic;
    const date = fmtDate(s.createdAt);
    const dur = fmtDur(s.duration);
    const note = s.note ? `<p class="s-note">${esc(s.note)}</p>` : '';
    return `<article class="story-item" data-id="${s.id}">
      <div class="s-cover ${now ? 's-cover-now' : ''}" data-action="play" role="button" aria-label="播放">${coverIcon}</div>
      <div class="s-body">
        <div class="s-top"><span class="s-title">${esc(s.title || '未命名故事')}</span><span class="s-date">${dur} · ${date}</span></div>
        ${note}
      </div>
      <div class="s-actions">
        <button class="s-act s-fav ${s.favorite ? 'is-on' : ''}" data-action="fav" aria-label="收藏">${fav}</button>
        <button class="s-act s-dl" data-action="download" aria-label="下载">${ICON.download}</button>
        <button class="s-act s-del" data-action="delete" aria-label="删除">${ICON.trash}</button>
      </div>
    </article>`;
  }).join('');
}

function updateStats() {
  const n = state.stories.length;
  const secs = state.stories.reduce((a, s) => a + (s.duration || 0), 0);
  $('#stats').textContent = n ? `已收藏 ${n} 个故事 · 共 ${fmtDur(secs)} 的温柔` : '还没有故事 · 今晚录第一个吧';
}

async function toggleFav(id) {
  const s = state.stories.find(x => x.id === id);
  if (!s) return;
  s.favorite = !s.favorite;
  await dbPut(s);
  renderStories(); syncPlayerUI();
  toast(s.favorite ? '已收藏' : '已取消收藏');
}

async function downloadStory(id) {
  const s = state.stories.find(x => x.id === id);
  if (!s) return;
  const url = getUrl(s);
  const a = document.createElement('a');
  a.href = url;
  const safe = (s.title || '晚安故事').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);
  a.download = `${safe}.${extFor(s.mime)}`;
  document.body.appendChild(a); a.click(); a.remove();
  toast('已开始下载，记得备份');
}

async function deleteStory(id) {
  const s = state.stories.find(x => x.id === id);
  if (!s) return;
  const ok = window.confirm(`确定删除「${s.title || '这个故事'}」吗？此操作无法恢复。`);
  if (!ok) return;
  await dbDelete(id);
  if (_urlCache[id]) { URL.revokeObjectURL(_urlCache[id]); delete _urlCache[id]; }
  state.stories = state.stories.filter(x => x.id !== id);
  if (state.currentId === id) stopToEnd();
  renderStories(); updateStats();
  toast('已删除');
}
