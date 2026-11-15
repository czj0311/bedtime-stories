/* ===== 账号 / 双人空间 / 解锁界面 + 本机同步挂钩 =====
   由 12-cloud 的 CloudSync 驱动；所有界面都在 #accountMask 内渲染。
   本文件同时实现与现有本机功能的衔接：保存后自动上传、收藏同步、
   删除传播、离线补传、旧故事导入。 */
let _acctRendered = '';
let _lastPosPush = 0;

function fmtSyncTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---- 顶部小徽章 ---- */
function updateCloudChip() {
  const chip = $('#cloudChip');
  if (!chip) return;
  const s = CloudSync.snapshot();
  if (!CloudSync.configured()) { chip.hidden = true; return; }
  chip.hidden = false;
  if (s.phase === 'ready') {
    const lastErr = CloudSync.getLastError && CloudSync.getLastError();
    if (s.pendingUploads > 0 && lastErr) { chip.textContent = '同步失败 · 点此查看'; chip.className = 'cloud-chip is-warn'; }
    else if (s.pendingUploads > 0) { chip.textContent = `待同步 ${s.pendingUploads}`; chip.className = 'cloud-chip is-warn'; }
    else if (CloudSync.state.syncing) { chip.textContent = '同步中…'; chip.className = 'cloud-chip is-busy'; }
    else if (navigator.onLine === false) { chip.textContent = '离线待同步'; chip.className = 'cloud-chip is-warn'; }
    else { chip.textContent = s.lastSyncAt ? `已同步 ${fmtSyncTime(s.lastSyncAt)}` : '已连接'; chip.className = 'cloud-chip is-ok'; }
  } else if (s.phase === 'locked') { chip.textContent = '已加密·未解锁'; chip.className = 'cloud-chip is-warn'; }
  else if (s.phase === 'nocouple') { chip.textContent = '未绑定双人'; chip.className = 'cloud-chip is-warn'; }
  else if (s.phase === 'signedout') { chip.textContent = '未登录'; chip.className = 'cloud-chip'; }
  else { chip.textContent = '双人空间'; chip.className = 'cloud-chip'; }
}

/* ---- 弹窗打开 / 状态机渲染 ---- */
function openAccountModal() { renderAccount(); $('#accountMask').hidden = false; }
function closeAccountModal() { $('#accountMask').hidden = true; }

function renderAccount() {
  const s = CloudSync.snapshot();
  const body = $('#acctBody');
  const status = $('#acctStatus');
  if (!body) return;
  const phase = s.phase;
  status.textContent = phaseText(s);
  // 用户正在表单里输入时，只更新状态行，不重建 DOM（避免打断输入）
  const typing = document.activeElement && body.contains(document.activeElement);
  const html = typing ? _acctRendered : phaseHtml(s, phase);
  if (html !== _acctRendered) { body.innerHTML = html; _acctRendered = html; }
  $('#acctLockBtn').hidden = !(phase === 'ready');
  $('#acctImportBtn').hidden = !(phase === 'ready' && state.stories.some(x => !x.cloudId && x.mine !== false));
  $('#acctRetryBtn').hidden = !(phase === 'ready' && state.stories.some(x => !x.cloudId && x.syncState === 'error'));
  $('#acctSignoutBtn').hidden = (phase === 'signedout' || phase === 'unconfigured' || phase === 'nosupport');
}

function phaseText(s) {
  switch (s.phase) {
    case 'unconfigured': return '当前为「仅本机」模式，所有功能正常，只是不同步';
    case 'nosupport': return '此设备的浏览器缺少 Web 加密能力，无法开启双人同步';
    case 'signedout': return '登录后即可开启两人的加密同步';
    case 'nocouple': return '创建你们的专属空间，或输入她给你的邀请码';
    case 'locked': return '输入恢复短语，解开今晚的加密故事';
    case 'ready': return s.partnerId
      ? `你们的空间已连接 · 内容全程加密`
      : `空间已建好 · 把邀请码和口令当面告诉她`;
    default: return '';
  }
}

function phaseHtml(s, phase) {
  const escEmail = s.user ? esc(s.user.email || '') : '';
  if (phase === 'unconfigured') {
    return `<div class="acct-note">按项目里的 <b>docs/SUPABASE_SETUP.md</b> 操作：
      注册 Supabase（免费档即可）→ 执行 supabase/schema.sql → 把地址和 anon key 填进 js/config.js，重新部署一次。
      之后你们俩各注册一个邮箱账号即可使用。<br>在配置完成前，录音仍只保存在本机。</div>`;
  }
  if (phase === 'nosupport') {
    return `<div class="acct-note">换用较新的浏览器（iOS 17+ Safari / 新版小米、华为浏览器）即可开启。</div>`;
  }
  if (phase === 'signedout') {
    return `
      <div class="acct-tabs"><button class="chip is-on" data-tab="signin">登录</button><button class="chip" data-tab="signup">注册</button></div>
      <form id="acctSigninForm" class="acct-form">
        <input type="email" id="acctEmail" placeholder="邮箱（可各自注册一个）" autocomplete="off" required>
        <input type="password" id="acctPass" placeholder="登录密码" autocomplete="new-password" minlength="8" required>
        <button class="primary-btn" type="submit">登录</button>
        <p class="acct-tip">登录密码只用于账号本身；故事内容用另一条恢复短语加密。</p>
      </form>
      <form id="acctSignupForm" class="acct-form" hidden>
        <input type="email" id="acctEmail2" placeholder="你的邮箱" autocomplete="off" required>
        <input type="password" id="acctPass2" placeholder="登录密码（至少 8 位）" autocomplete="new-password" minlength="8" required>
        <button class="primary-btn" type="submit">注册账号</button>
        <p class="acct-tip">注册后可能收到确认邮件，点过链接再回来登录。</p>
      </form>`;
  }
  if (phase === 'nocouple') {
    return `
      <form id="acctCreateForm" class="acct-form">
        <p class="acct-label">由你创建（她稍后加入）</p>
        <input type="password" id="acctPhrase" placeholder="恢复短语：4 个以上随机词语，当面告诉她" autocomplete="new-password">
        <p class="acct-tip" id="acctStrength">短语用于加密全部故事，遗忘后无法找回，请务必记牢</p>
        <input type="password" id="acctPhrase2" placeholder="再输入一遍确认" autocomplete="new-password">
        <button class="primary-btn" type="submit">创建我们的空间</button>
      </form>
      <div class="acct-divider">或</div>
      <form id="acctJoinForm" class="acct-form">
        <p class="acct-label">她已创建时，输入邀请码加入</p>
        <input type="text" id="acctInvite" placeholder="邀请码（48 位，她分享给你）" autocomplete="off">
        <input type="password" id="acctPhraseJoin" placeholder="她私下告诉你的恢复短语" autocomplete="new-password">
        <button class="primary-btn" type="submit">加入她的空间</button>
      </form>`;
  }
  if (phase === 'locked' || phase === 'novault') {
    if (!s.vault) {
      if (s.isCreator) {
        return `
          <p class="acct-note">空间已建好，但加密口令还没保存成功。在这里补完设置即可，<b>不需要重置</b>。</p>
          <form id="acctFinishForm" class="acct-form">
            <p class="acct-label">设置恢复短语（两人共用，当面告诉她）</p>
            <input type="password" id="acctFinishPhrase" placeholder="4 个以上随机词语，至少 12 个字符" autocomplete="new-password">
            <p class="acct-tip" id="acctFinishStrength">短语是全部故事的唯一钥匙，遗忘后无法找回</p>
            <input type="password" id="acctFinishPhrase2" placeholder="再输入一遍确认" autocomplete="new-password">
            <button class="primary-btn" type="submit">完成设置</button>
          </form>`;
      }
      return `<div class="acct-note">创建者还没完成口令设置。等她在自己手机上补完后，点下面的按钮检查；也可以直接刷新页面。</div>
        <div class="acct-form"><button class="chip" type="button" id="acctRefreshBtn">已设置好？检查一次</button></div>`;
    }
    return `
      <form id="acctUnlockForm" class="acct-form">
        <p class="acct-label">登录为 ${escEmail}</p>
        <input type="password" id="acctUnlockPhrase" placeholder="恢复短语" autocomplete="off">
        <button class="primary-btn" type="submit">解锁今晚的故事</button>
        <p class="acct-tip">密钥只在本页运行期间驻留内存；离开页面超过 10 分钟会自动锁定。</p>
      </form>`;
  }
  if (phase === 'ready') {
    const invite = s.inviteCode && !s.partnerId
      ? `<div class="acct-invite"><p class="acct-label">邀请码（7 天内有效，当面给她）</p><code>${esc(s.inviteCode)}</code></div>` : '';
    const partner = s.partnerId
      ? `<p class="acct-ok">你们俩都已连接，内容端到端加密同步中</p>`
      : `<p class="acct-tip">她还没加入；加入后这里会变成两人的空间</p>`;
    const lastErr = CloudSync.getLastError && CloudSync.getLastError();
    const errBox = lastErr
      ? `<div class="acct-invite"><p class="acct-label">最近一次同步失败 · ${esc(lastErr.stage || '同步')}</p><code>${esc(lastErr.message || '')}</code></div>`
      : '';
    return `
      <p class="acct-label">当前登录：${escEmail}</p>
      ${partner}
      ${errBox}
      ${invite}
      <p class="acct-tip">上次同步：${s.lastSyncAt ? fmtSyncTime(s.lastSyncAt) : '刚刚'} · 待上传 ${s.pendingUploads} 条</p>`;
  }
  return '';
}

/* ---- 弹窗事件 ---- */
$('#accountMask').addEventListener('click', e => {
  if (e.target === $('#accountMask')) closeAccountModal();
});
$('#acctCloseBtn').addEventListener('click', closeAccountModal);
$('#acctLockBtn').addEventListener('click', () => {
  CloudSync.lock();
  toast('已锁定，恢复短语重新解锁');
  renderAccount(); updateCloudChip();
});
$('#acctSignoutBtn').addEventListener('click', async () => {
  if (!window.confirm('退出后本机故事仍保留，重新登录即可回来。确定退出？')) return;
  await CloudSync.signOut();
  renderAccount(); updateCloudChip();
  toast('已退出账号');
});
$('#acctRetryBtn').addEventListener('click', async () => {
  toast('正在重试同步…');
  try {
    const r = await CloudSync.forceSync();
    renderAccount(); updateCloudChip(); renderStories();
    toast(r && r.uploaded ? `已补传 ${r.uploaded} 条` : '仍未成功，点「网络诊断」查看原因');
  } catch (e) { toast('重试失败：' + ((e && e.message) || '未知错误')); }
});
$('#acctImportBtn').addEventListener('click', async () => {
  const olds = state.stories.filter(x => !x.cloudId && x.mine !== false);
  if (!olds.length) { toast('没有待导入的旧故事'); return; }
  if (!window.confirm(`将把本机 ${olds.length} 个旧故事加密上传到云端，她也能听到。确定？`)) return;
  for (const s of olds) { s.syncState = 'pending'; await dbPut(s); }
  renderStories(); updateCloudChip();
  await CloudSync.retryPendingUploads(null);
  toast('已开始加密上传旧故事');
  renderAccount();
});

$('#acctBody').addEventListener('click', e => {
  if (e.target.closest('#acctRefreshBtn')) {
    CloudSync.refreshCouple().then(() => {
      _acctRendered = ''; renderAccount(); updateCloudChip();
      toast(CloudSync.snapshot().vault ? '已同步，输入恢复短语解锁' : '创建者还没完成设置，稍后再试');
    }).catch(() => toast('检查失败，稍后再试'));
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (!tab) return;
  $$('#acctBody .acct-tabs .chip').forEach(b => b.classList.toggle('is-on', b === tab));
  $('#acctSigninForm').hidden = tab.dataset.tab !== 'signin';
  $('#acctSignupForm').hidden = tab.dataset.tab !== 'signup';
});

/* 把常见的英文 Auth 报错翻成可执行的中文提示 */
function friendlyAuthError(err) {
  const msg = (err && err.message) || '';
  const code = (err && err.code) || '';
  if (code === 'signup_disabled' || /signups?\s+(are|is)\s+disabled|email signups are disabled/i.test(msg)) {
    return '云端关闭了公开注册。请在 Supabase 控制台手动建好两个账号后使用「登录」，或打开「允许新用户注册」开关再注册。';
  }
  if (/invalid login credentials/i.test(msg)) return '邮箱或密码不正确，检查一下再试';
  if (/user already registered|already been registered/i.test(msg)) return '这个邮箱已注册，请切到「登录」';
  if (/email not confirmed/i.test(msg)) return '邮箱还没确认：去邮箱点确认链接，或在控制台关闭 Confirm email';
  if (/password should be at least|password is too short/i.test(msg)) return '密码太短，至少 8 位';
  if (/超时|failed to fetch|networkerror|network request failed|load failed|fetch failed|ERR_/i.test(msg)) {
    return '连不上云端：当前 WiFi 可能拦截了 supabase.co。换移动数据、改 DNS，或点「网络诊断」定位';
  }
  return msg || '操作失败，稍后再试';
}

const _acctBusy = el => { if (el) { el.disabled = true; el.textContent = '请稍候…'; setTimeout(() => { el.disabled = false; el.textContent = el.dataset.label || '确定'; }, 8000); } };

$('#acctBody').addEventListener('submit', async e => {
  const form = e.target;
  e.preventDefault();
  const btn = form.querySelector('button[type=submit]'); btn.dataset.label = btn.textContent;
  try {
    if (form.id === 'acctSigninForm') {
      _acctBusy(btn);
      await CloudSync.signIn($('#acctEmail').value.trim(), $('#acctPass').value);
      toast('欢迎回来');
      renderAccount(); updateCloudChip();
    } else if (form.id === 'acctSignupForm') {
      _acctBusy(btn);
      const ok = await CloudSync.signUp($('#acctEmail2').value.trim(), $('#acctPass2').value);
      if (!ok) toast('注册成功！去邮箱点一下确认链接，再回来登录');
      else { toast('注册成功'); renderAccount(); }
      updateCloudChip();
    } else if (form.id === 'acctFinishForm') {
      const f1 = $('#acctFinishPhrase').value;
      const f2 = $('#acctFinishPhrase2').value;
      if (f1 !== f2) { toast('两次输入的短语不一致'); return; }
      _acctBusy(btn);
      await CloudSync.completeSetup(f1);
      _acctRendered = '';
      toast('设置完成，把邀请码和短语当面告诉她');
      renderAccount(); updateCloudChip();
      CloudSync.syncAll({ silent: true });
    } else if (form.id === 'acctCreateForm') {
      const p1 = $('#acctPhrase').value;
      const p2 = $('#acctPhrase2').value;
      if (p1 !== p2) { toast('两次输入的短语不一致'); return; }
      _acctBusy(btn);
      const code = await CloudSync.createCouple(p1);
      toast('空间已创建，把邀请码和短语告诉她');
      renderAccount();
      CloudSync.syncAll({ silent: true });
    } else if (form.id === 'acctJoinForm') {
      const code = $('#acctInvite').value.trim();
      const phrase = $('#acctPhraseJoin').value;
      if (!code) { toast('请输入邀请码'); return; }
      _acctBusy(btn);
      await CloudSync.joinCouple(code, phrase);
      toast('已加入你们的空间');
      renderAccount(); updateCloudChip();
      setTimeout(() => { if (CloudSync.active()) CloudSync.syncAll({ silent: true }); }, 300);
    } else if (form.id === 'acctUnlockForm') {
      _acctBusy(btn);
      await CloudSync.unlock($('#acctUnlockPhrase').value);
      toast('已解锁，晚安故事开始同步');
      renderAccount(); updateCloudChip();
    }
  } catch (err) {
    toast(friendlyAuthError(err));
  }
}, true);

$('#acctBody').addEventListener('input', e => {
  const el = e.target;
  if (el && (el.id === 'acctPhrase' || el.id === 'acctFinishPhrase')) {
    const tip = $(el.id === 'acctPhrase' ? '#acctStrength' : '#acctFinishStrength');
    if (tip) {
      const r = BedtimeCrypto.passStrength(el.value);
      tip.textContent = r.msg + (r.ok ? ' · 够强了' : '');
      tip.classList.toggle('is-ok', r.ok);
    }
  }
});

/* ---- CloudSync 状态变化 -> 界面 ---- */
CloudSync.onChange(reason => {
  updateCloudChip();
  if (!$('#accountMask').hidden) renderAccount();
  if (reason === 'remote-insert') toast('她刚存了一个新故事');
});
$('#cloudChip').addEventListener('click', openAccountModal);
$('#accountBtn').addEventListener('click', openAccountModal);

/* ---- 与本机功能的挂钩（供 9-modals / 6-library / 7-player 调用） ---- */
async function onStorySavedLocally(story) {
  if (!CloudSync.active()) return;
  story.mine = true; story.syncState = 'pending';
  await dbPut(story);
  updateCloudChip(); renderStories();
  CloudSync.retryPendingUploads(null).catch(() => {});
}

function cloudPendingStories() {
  return state.stories.filter(s => !s.cloudId && (s.syncState === 'pending' || s.syncState === 'error') && s.mine !== false);
}

function cloudKnownIds() {
  const ids = state.stories.filter(s => s.cloudId).map(s => s.cloudId);
  return ids;
}

async function onStorySyncState(localId, syncState, errorMsg) {
  const s = state.stories.find(x => x.id === localId);
  if (!s) return;
  s.syncState = syncState;
  if (syncState === 'error' && errorMsg) s.lastSyncError = errorMsg;
  else if (syncState !== 'error') delete s.lastSyncError;
  await dbPut(s);
  renderStories(); updateCloudChip();
}

async function onStoryUploaded(localId, cloudId, byteSize) {
  const s = state.stories.find(x => x.id === localId);
  if (!s) return;
  s.cloudId = cloudId; s.syncState = 'synced'; s.mine = true;
  await dbPut(s);
  renderStories(); updateCloudChip();
}

async function onRemoteStoryArrived(story) {
  if (state.stories.some(x => x.cloudId === story.cloudId)) return false;
  story.id = uid();
  try { await dbAdd(story); } catch (e) { return false; }
  state.stories.push(story);
  state.stories.sort((a, b) => b.createdAt - a.createdAt);
  renderStories(); updateStats(); updateCloudChip();
  return true;
}

async function onRemoteStoryDeleted(cloudId) {
  const s = state.stories.find(x => x.cloudId === cloudId);
  if (!s) return;
  try { await dbDelete(s.id); } catch (e) {}
  if (_urlCache[s.id]) { URL.revokeObjectURL(_urlCache[s.id]); delete _urlCache[s.id]; }
  state.stories = state.stories.filter(x => x.id !== s.id);
  if (state.currentId === s.id) stopToEnd();
  renderStories(); updateStats();
  toast('她删除了一个故事');
}

function onFavoriteToggled(story) {
  if (CloudSync.active() && story.cloudId) {
    CloudSync.saveStoryState(story.cloudId, { favorite: !!story.favorite });
  }
}

function onStoryDeletedLocally(story) {
  if (story.cloudId && CloudSync.active()) {
    CloudSync.deleteCloudStory(story.cloudId).catch(() => {});
  } else if (story.cloudId) {
    CloudSync.addTombstone(story.cloudId);
  }
}

function onPositionSaved(localId, t) {
  if (!CloudSync.active()) return;
  const now = Date.now();
  if (now - _lastPosPush < 30000) return;
  const s = state.stories.find(x => x.id === localId);
  if (!s || !s.cloudId) return;
  _lastPosPush = now;
  CloudSync.saveStoryState(s.cloudId, { position: t, favorite: !!s.favorite });
}

/* ---- 启动 ---- */
(async function initAccount() {
  await CloudSync.init();
  updateCloudChip();
  setInterval(() => { if (CloudSync.active() && navigator.onLine !== false) CloudSync.syncAll({ silent: true }); }, 5 * 60 * 1000);
})();
