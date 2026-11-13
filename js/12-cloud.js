/* ===== 云端同步层（Supabase）=====
   职责：登录、双人空间绑定、端到端加密上传/下载、Realtime 通知、离线补传。
   不直接操作 DOM；状态变化通过 CloudSync.listeners 通知（13-account 负责界面）。
   未配置 config 或未登录/未解锁时，全部方法安全返回，不影响本机功能。 */
const CloudSync = (() => {
  const TOMB_KEY = 'bs-tombstones';
  const AUDIO_BUCKET = 'story-audio';
  const LIST_LIMIT = 500;

  const listeners = [];
  const st = {
    phase: 'unconfigured', // unconfigured|nosupport|offline|signedout|nocouple|locked|ready
    user: null,            // {id,email}
    coupleId: null,
    partnerId: null,
    key: null,             // CryptoKey（解锁后驻留内存）
    vault: null,           // {salt,iterations,wrappedKey,iv,version}
    inviteCode: null,
    lastSyncAt: null,
    pendingUploads: 0,
    client: null,
    channel: null,
    syncing: false,
    hiddenAt: null
  };

  function notify(reason) {
    listeners.forEach(fn => { try { fn(reason, snapshot()); } catch (e) {} });
  }
  function snapshot() {
    return {
      phase: st.phase, user: st.user, coupleId: st.coupleId,
      partnerId: st.partnerId, inviteCode: st.inviteCode,
      unlocked: !!st.key, lastSyncAt: st.lastSyncAt,
      pendingUploads: st.pendingUploads, vault: st.vault
    };
  }
  function onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

  const configured = () => !!(BedtimeConfig.SUPABASE_URL && BedtimeConfig.SUPABASE_ANON_KEY);
  const active = () => st.phase === 'ready';
  const online = () => navigator.onLine !== false;

  function audioPathFor(cloudId) { return `${st.coupleId}/${cloudId}.mp3.enc`; }

  /* ---- 墓碑：本机已删、云端待删的故事 ---- */
  function loadTombstones() {
    try { return JSON.parse(localStorage.getItem(TOMB_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveTombstones(t) {
    try { localStorage.setItem(TOMB_KEY, JSON.stringify(t)); } catch (e) {}
  }
  function addTombstone(cloudId) {
    if (!cloudId) return;
    const t = loadTombstones(); t[cloudId] = Date.now(); saveTombstones(t);
  }
  function removeTombstone(cloudId) {
    const t = loadTombstones();
    if (cloudId in t) { delete t[cloudId]; saveTombstones(t); }
  }

  /* ---- 初始化 ---- */
  async function init() {
    if (!BedtimeCrypto.isSupported()) { st.phase = 'nosupport'; notify('nosupport'); return; }
    if (!configured()) { st.phase = 'unconfigured'; notify('unconfigured'); return; }

    try {
      st.client = window.BedtimeVendor.createClient(
        BedtimeConfig.SUPABASE_URL, BedtimeConfig.SUPABASE_ANON_KEY,
        { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bs-auth' } }
      );
    } catch (e) {
      st.phase = 'unconfigured'; notify('unconfigured'); return;
    }

    st.client.auth.onAuthStateChange((_ev, session) => { restoreSession(); });

    window.addEventListener('online', () => { notify('online'); syncAll({ silent: true }); });
    window.addEventListener('offline', () => notify('offline'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        st.hiddenAt = Date.now();
      } else if (st.hiddenAt && Date.now() - st.hiddenAt > 10 * 60 * 1000 && st.key) {
        lock(); // 离开页面超过 10 分钟自动清除内存中的密钥
      }
      st.hiddenAt = document.hidden ? st.hiddenAt : null;
    });

    await restoreSession();
  }

  async function restoreSession() {
    if (!st.client) return;
    try {
      const { data } = await st.client.auth.getSession();
      st.user = data && data.session ? { id: data.session.user.id, email: data.session.user.email } : null;
    } catch (e) { st.user = null; }
    if (!st.user) {
      st.phase = 'signedout'; st.coupleId = null; st.partnerId = null; st.key = null; st.vault = null;
      notify('signedout'); return;
    }
    await loadCouple();
  }

  /* ---- 登录 / 注册 / 退出 ---- */
  async function signUp(email, password) {
    const { data, error } = await st.client.auth.signUp({ email, password });
    if (error) throw error;
    if (data && data.session && data.session.user) {
      st.user = { id: data.session.user.id, email: data.session.user.email };
      await loadCouple();
    }
    return !!(data && data.session); // false = 需要先去邮箱确认
  }
  async function signIn(email, password) {
    const { error } = await st.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await restoreSession();
  }
  async function signOut() {
    if (st.channel) { try { st.client.removeChannel(st.channel); } catch (e) {} st.channel = null; }
    try { await st.client.auth.signOut(); } catch (e) {}
    st.user = null; st.coupleId = null; st.partnerId = null; st.key = null; st.vault = null;
    st.phase = 'signedout';
    notify('signedout');
  }
  function lock() {
    st.key = null;
    if (st.phase === 'ready') st.phase = 'locked';
    notify('locked');
  }

  /* ---- 双人空间 ---- */
  async function loadCouple() {
    if (!st.user) return;
    const { data: member, error: e1 } = await st.client
      .from('couple_members').select('couple_id').eq('user_id', st.user.id).maybeSingle();
    if (e1 || !member) { st.phase = 'nocouple'; st.coupleId = null; st.vault = null; notify('nocouple'); return; }
    st.coupleId = member.couple_id;

    const { data: members } = await st.client
      .from('couple_members').select('user_id').eq('couple_id', st.coupleId);
    st.partnerId = (members || []).map(m => m.user_id).find(id => id !== st.user.id) || null;

    const { data: couple, error: e2 } = await st.client
      .from('couples')
      .select('id, invite_code, key_salt, wrapped_key, key_iv, kdf_iterations, key_version')
      .eq('id', st.coupleId).maybeSingle();
    if (e2 || !couple || !couple.wrapped_key) {
      // 创建者尚未设置口令：等待其先完成设置
      st.vault = null; st.phase = 'locked'; notify('novault'); return;
    }
    st.inviteCode = couple.invite_code || st.inviteCode;
    st.vault = {
      salt: couple.key_salt, wrappedKey: couple.wrapped_key, iv: couple.key_iv,
      iterations: couple.kdf_iterations || BedtimeCrypto.PBKDF2_ITERATIONS,
      version: couple.key_version || 1
    };
    st.phase = st.key ? 'ready' : 'locked';
    if (st.key) subscribeRealtime();
    notify(st.phase);
  }

  /* 创建者：建空间 + 生成双人密钥并写入包裹元数据 */
  async function createCouple(passphrase) {
    const strength = BedtimeCrypto.passStrength(passphrase);
    if (!strength.ok) throw new Error(strength.msg);
    const { data, error } = await st.client.rpc('create_couple');
    if (error) throw new Error(error.message);
    st.coupleId = data.id;
    st.inviteCode = data.invite_code;
    const { key, vault } = await BedtimeCrypto.wrapCoupleKey(passphrase);
    const { error: upErr } = await st.client.from('couples')
      .update({
        key_salt: vault.salt, wrapped_key: vault.wrappedKey,
        key_iv: vault.iv, kdf_iterations: vault.iterations, key_version: vault.version
      })
      .eq('id', st.coupleId);
    if (upErr) throw new Error('密钥保存失败：' + upErr.message);
    st.key = key; st.vault = vault; st.phase = 'ready';
    await loadCouple();
    subscribeRealtime();
    return data.invite_code;
  }

  /* 加入者：凭邀请码进入，再用创建者私下告知的口令解开双人密钥 */
  async function joinCouple(inviteCode, passphrase) {
    const { data, error } = await st.client.rpc('join_couple', { code: inviteCode.trim() });
    if (error) {
      const msg = error.message || '';
      if (/full/i.test(msg)) throw new Error('这个空间已经有两个人了');
      if (/expire/i.test(msg)) throw new Error('邀请码已过期（7 天有效），请让她重新生成');
      if (/invalid/i.test(msg)) throw new Error('邀请码不正确');
      throw new Error(msg);
    }
    await loadCouple();
    return unlock(passphrase);
  }

  async function unlock(passphrase) {
    if (!st.vault) throw new Error('创建者还没设置好口令，稍等片刻再试');
    try {
      st.key = await BedtimeCrypto.unwrapCoupleKey(st.vault, passphrase);
    } catch (e) {
      if (e && e.code === 'BAD_PASSPHRASE') throw new Error('恢复短语不正确');
      throw e;
    }
    st.phase = 'ready';
    subscribeRealtime();
    notify('unlocked');
    await syncAll({ silent: true });
  }

  /* ---- Realtime ---- */
  function subscribeRealtime() {
    if (!st.client || !st.coupleId || st.channel) return;
    try {
      st.channel = st.client
        .channel('stories-' + st.coupleId)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'stories', filter: `couple_id=eq.${st.coupleId}` },
          payload => { onRemoteInsert(payload.new); })
        .on('postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'stories', filter: `couple_id=eq.${st.coupleId}` },
          payload => { onRemoteDelete(payload.old); })
        .subscribe();
    } catch (e) { st.channel = null; }
  }

  async function onRemoteInsert(row) {
    if (!row || !active()) return;
    if (row.author_id === st.user.id) return; // 自己的上传，本地已有
    await fetchRemoteStory(row.id);
    notify('remote-insert');
  }
  function onRemoteDelete(oldRow) {
    if (!oldRow || !oldRow.id) return;
    removeTombstone(oldRow.id); // 若是我本地删除的传播，到此结束
    notify('remote-delete');    // 13-account 会调用 forgetRemoteStory 移除本地副本
    if (typeof onRemoteStoryDeleted === 'function') onRemoteStoryDeleted(oldRow.id);
  }

  /* ---- 上传一条本地故事（端到端加密） ---- */
  async function uploadStory(story) {
    if (!active() || !story || story.cloudId) return { skipped: true };
    const cloudId = BedtimeCrypto.randomUuid();
    const path = audioPathFor(cloudId);

    const content = await BedtimeCrypto.encryptJson(st.key, { t: story.title || '', n: story.note || '' });
    const bytes = await BedtimeCrypto.encryptBytes(st.key, await story.blob.arrayBuffer());

    // 先传音频，成功后再写行 —— 对方收到通知时音频一定已可下载
    const { error: upErr } = await st.client.storage
      .from(AUDIO_BUCKET)
      .upload(path, bytes.cipher, { contentType: 'application/octet-stream', upsert: false });
    if (upErr) throw new Error('音频上传失败：' + (upErr.message || '网络异常'));

    const { error: insErr } = await st.client.from('stories').insert({
      id: cloudId,
      couple_id: st.coupleId,
      author_id: st.user.id,
      content_cipher: content.cipher,
      content_iv: content.iv,
      audio_path: path,
      audio_iv: bytes.iv,
      mime: story.mime || 'audio/mpeg',
      duration: Math.max(0, Math.floor(story.duration || 0)),
      byte_size: bytes.cipher.byteLength
    });
    if (insErr) {
      try { await st.client.storage.from(AUDIO_BUCKET).remove([path]); } catch (e) {}
      throw new Error('故事记录写入失败：' + (insErr.message || ''));
    }
    return { cloudId, byteSize: bytes.cipher.byteLength };
  }

  /* ---- 下载一条云端故事并解密 ---- */
  async function fetchRemoteStory(cloudId) {
    if (!active()) return null;
    const { data: row, error } = await st.client
      .from('stories').select('*').eq('id', cloudId).maybeSingle();
    if (error || !row) return null;
    if (row.author_id === st.user.id) return null;

    const content = await BedtimeCrypto.decryptJson(st.key, row.content_cipher, row.content_iv);
    const { data: blob, error: dlErr } = await st.client.storage
      .from(AUDIO_BUCKET).download(row.audio_path);
    if (dlErr || !blob) throw new Error('音频下载失败');
    const plain = await BedtimeCrypto.decryptBytes(st.key, await blob.arrayBuffer(), row.audio_iv);

    return {
      cloudId: row.id,
      title: content.t || '未命名故事',
      note: content.n || '',
      blob: new Blob([plain], { type: row.mime || 'audio/mpeg' }),
      mime: row.mime || 'audio/mpeg',
      duration: row.duration || 0,
      createdAt: Date.parse(row.created_at) || Date.now(),
      favorite: false,
      syncState: 'synced',
      mine: false
    };
  }

  /* ---- 我的收藏 / 播放进度（story_states 只属于我自己） ---- */
  async function saveStoryState(cloudId, fields) {
    if (!active() || !cloudId || !st.user) return;
    try {
      await st.client.from('story_states').upsert({
        story_id: cloudId, user_id: st.user.id,
        favorite: !!fields.favorite, position: Math.max(0, Math.floor(fields.position || 0))
      });
    } catch (e) { /* 状态同步失败不打断使用 */ }
  }

  /* ---- 删除 ---- */
  async function deleteCloudStory(cloudId) {
    if (!active() || !cloudId) return;
    const path = audioPathFor(cloudId);
    addTombstone(cloudId);
    try { await st.client.from('stories').delete().eq('id', cloudId); } catch (e) {}
    try { await st.client.storage.from(AUDIO_BUCKET).remove([path]); } catch (e) {}
    removeTombstone(cloudId);
    notify('deleted');
  }

  /* ---- 全量同步（登录/解锁/联网/手动触发） ---- */
  async function syncAll(opts) {
    opts = opts || {};
    if (!active() || st.syncing || !online()) return { skipped: true };
    st.syncing = true; notify('syncing');
    const result = { uploaded: 0, added: 0, deleted: 0, errors: [] };
    try {
      // 1. 处理离线期间本机删除的故事
      const tombs = loadTombstones();
      for (const cloudId of Object.keys(tombs)) {
        try {
          await st.client.from('stories').delete().eq('id', cloudId);
          await st.client.storage.from(AUDIO_BUCKET).remove([audioPathFor(cloudId)]);
        } catch (e) {}
        removeTombstone(cloudId);
        result.deleted++;
      }

      // 2. 补传本机待同步的故事（断网录音 / 旧故事导入）
      await retryPendingUploads(result);

      // 3. 拉取云端列表，下载缺失的故事
      const { data: rows, error } = await st.client
        .from('stories')
        .select('id, author_id, created_at, duration, audio_path')
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);
      if (!error && rows) {
        const known = new Set((typeof cloudKnownIds === 'function' ? cloudKnownIds() : []));
        for (const row of rows) {
          if (known.has(row.id)) continue;
          if (row.author_id === st.user.id) continue;
          try {
            const story = await fetchRemoteStory(row.id);
            if (story && typeof onRemoteStoryArrived === 'function') {
              if (await onRemoteStoryArrived(story)) result.added++;
            }
          } catch (e) { result.errors.push(row.id); }
        }
      }

      st.lastSyncAt = Date.now();
      notify('synced');
      return result;
    } finally {
      st.syncing = false;
      notify('sync-done');
    }
  }

  async function retryPendingUploads(result) {
    if (!active()) return;
    const pending = typeof cloudPendingStories === 'function' ? cloudPendingStories() : [];
    st.pendingUploads = pending.length;
    notify('pending-changed');
    for (const story of pending) {
      try {
        if (typeof onStorySyncState === 'function') onStorySyncState(story.id, 'syncing');
        const r = await uploadStory(story);
        if (r && !r.skipped) {
          if (typeof onStoryUploaded === 'function') {
            await onStoryUploaded(story.id, r.cloudId, r.byteSize);
          }
          st.pendingUploads = Math.max(0, st.pendingUploads - 1);
          if (result) result.uploaded++;
        }
      } catch (e) {
        if (typeof onStorySyncState === 'function') onStorySyncState(story.id, 'error');
      }
    }
    notify('pending-changed');
  }

  return {
    init, onChange, snapshot,
    configured, active, lock, signOut,
    signUp, signIn, createCouple, joinCouple, unlock,
    uploadStory, fetchRemoteStory, saveStoryState, deleteCloudStory,
    syncAll, retryPendingUploads, addTombstone,
    get state() { return st; }
  };
})();
