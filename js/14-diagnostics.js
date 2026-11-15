/* ===== 连接诊断 =====
   目的：在 iPhone / 华为 / 小米、WiFi / 移动数据下各跑一次，
   把「登录差异」和「同步失败」定位到具体环节。
   只读检测 + 可逆的写入探针（测试文件与测试行都会立即删除），不留数据。 */
(() => {
  const $ = s => document.querySelector(s);
  const out = () => $('#diagOut');
  let report = '';

  const line = (s = '') => { report += s + '\n'; if (out()) out().textContent = report; };
  const now = () => new Date().toLocaleString('zh-CN', { hour12: false });

  function maskKey(k) {
    if (!k) return '(空)';
    return k.slice(0, 18) + '…（' + k.length + ' 字符）';
  }

  async function timedFetch(url, opts, label) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t0 = performance.now();
    let timer = null;
    if (ctrl) timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const r = await fetch(url, Object.assign({ signal: ctrl ? ctrl.signal : undefined }, opts || {}));
      const ms = Math.round(performance.now() - t0);
      let body = '';
      try { body = (await r.text()).slice(0, 220); } catch (e) {}
      line(`[${label}] HTTP ${r.status} · ${ms}ms · ${body || '(无响应体)'}`);
      return { ok: true, status: r.status, ms };
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      line(`[${label}] ✗ 无法连接 · ${ms}ms · ${(e && e.message) || e}`);
      return { ok: false, ms };
    } finally { if (timer) clearTimeout(timer); }
  }

  async function checkStorage(kind) {
    try {
      const key = '__bs_diag__';
      if (kind === 'localStorage') {
        localStorage.setItem(key, '1');
        const v = localStorage.getItem(key);
        localStorage.removeItem(key);
        return v === '1' ? '可读写' : '读取异常';
      }
      return await new Promise(resolve => {
        const req = indexedDB.open('__bs_diag_db__', 1);
        req.onsuccess = () => { try { req.result.close(); } catch (e) {} try { indexedDB.deleteDatabase('__bs_diag_db__'); } catch (e) {} resolve('可读写'); };
        req.onerror = () => resolve('不可写 ✗');
        req.onblocked = () => resolve('被阻塞');
        setTimeout(() => resolve('超时'), 3000);
      });
    } catch (e) { return '不可写 ✗（' + ((e && e.name) || '异常') + '）'; }
  }

  async function envSection() {
    const meta = document.querySelector('meta[name="build"]');
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const snap = (typeof CloudSync !== 'undefined') ? CloudSync.snapshot() : null;
    const st = (typeof CloudSync !== 'undefined') ? CloudSync.state : null;

    line('=== 晚安故事 · 连接诊断 ===');
    line('时间：' + now());
    line('构建：' + (meta ? meta.content : '未知（可能是旧缓存页面）'));
    line('地址：' + location.href);
    line('UA：' + navigator.userAgent);
    line('平台：' + (navigator.platform || '?') + ' · 独立PWA：' + (window.navigator.standalone || matchMedia('(display-mode: standalone)').matches ? '是' : '否'));
    line('网络：' + (conn ? (conn.type || '?') + ' / ' + (conn.effectiveType || '?') : '浏览器未提供') + ' · navigator.onLine=' + navigator.onLine);
    line('HTTPS 安全上下文：' + (window.isSecureContext ? '是' : '否 ✗（WebCrypto 会不可用）'));
    line('WebCrypto：' + ((typeof crypto !== 'undefined' && crypto.subtle) ? '支持' : '不支持 ✗'));
    line('localStorage：' + await checkStorage('localStorage'));
    line('IndexedDB：' + await checkStorage('indexedDB'));

    let swInfo = '不支持';
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        swInfo = reg ? '已注册（' + (reg.active ? 'active' : 'installing') + '）' : '未注册';
        const keys = (typeof caches !== 'undefined') ? await caches.keys() : [];
        swInfo += ' · 缓存=' + (keys.join(',') || '无');
      } catch (e) { swInfo = '检查失败：' + (e && e.message); }
    }
    line('Service Worker：' + swInfo);

    const cfg = (typeof BedtimeConfig !== 'undefined') ? BedtimeConfig : null;
    line('config.js：URL=' + (cfg ? (cfg.SUPABASE_URL || '(空)') : '未加载 ✗') + ' · key=' + (cfg ? maskKey(cfg.SUPABASE_ANON_KEY) : '?'));
    line('云端状态：' + (snap ? snap.phase : 'CloudSync 未加载 ✗'));

    if (snap && snap.user) {
      line('账号：' + (snap.user.email || '?') + ' · uid=' + snap.user.id);
      line('双人空间：' + (snap.coupleId || '未创建') + ' · 创建者=' + (snap.isCreator ? '是' : '否') + ' · 对方=' + (snap.partnerId ? '已加入' : '未加入') + ' · 密钥=' + (snap.vault ? '云端已就绪' : '未设置 ✗'));
    } else {
      line('账号：未登录');
    }

    let token = null, role = '?';
    try {
      if (st && st.client) {
        const { data } = await st.client.auth.getSession();
        if (data && data.session) {
          token = data.session.access_token;
          const p = token.split('.')[1];
          if (p) role = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))).role || '?';
        }
      }
    } catch (e) {}
    line('会话 JWT 角色：' + role);

    const lastErr = (typeof CloudSync !== 'undefined' && CloudSync.getLastError) ? CloudSync.getLastError() : null;
    line('最近同步错误：' + (lastErr ? `[${lastErr.stage}] ${lastErr.message}` : '无'));
    line('待同步条数：' + (snap ? snap.pendingUploads : '?'));
    return { cfg, token, st };
  }

  async function networkSection(cfg, token) {
    line('');
    line('--- 网络连通（任何 HTTP 状态码都代表网络通；✗ 才是被拦截）---');
    if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      line('config.js 未配置，跳过。若设备显示「仅本机模式」，多半是旧缓存，请点「强制更新缓存」。');
      return;
    }
    const base = cfg.SUPABASE_URL.replace(/\/$/, '');
    const headers = {
      apikey: cfg.SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + (token || cfg.SUPABASE_ANON_KEY)
    };
    const results = [];
    results.push(await timedFetch(base + '/auth/v1/health', { headers }, 'Auth 登录服务'));
    results.push(await timedFetch(base + '/rest/v1/couples?select=id&limit=1', { headers }, 'REST 数据库'));
    results.push(await timedFetch(base + '/storage/v1/bucket', { headers }, 'Storage 存储'));
    const bad = results.filter(r => !r.ok).length;
    if (bad) {
      line('结论：有 ' + bad + ' 项连不上 → 当前网络拦截了 supabase.co（切移动数据 / 改 DNS / 关掉 WiFi 的 IPv6 再试）。');
    } else {
      line('结论：三个云端端点均可达，网络层正常；若仍登录失败，问题在账号或浏览器存储。');
    }
  }

  async function dbSection(st) {
    line('');
    line('--- 数据库读取（需已登录）---');
    if (!st || !st.client) { line('未登录，跳过。'); return; }
    try {
      const r = await st.client.from('stories').select('id').limit(1);
      line('[SELECT stories] ' + (r.error ? '✗ ' + r.error.message + ' (code ' + r.error.code + ')' : '✓ 正常'));
    } catch (e) { line('[SELECT stories] ✗ ' + ((e && e.message) || e)); }
    try {
      const r = await st.client.from('couples').select('id, wrapped_key').limit(1);
      line('[SELECT couples] ' + (r.error ? '✗ ' + r.error.message : '✓ 正常，行数=' + (r.data || []).length));
    } catch (e) { line('[SELECT couples] ✗ ' + ((e && e.message) || e)); }
  }

  /* 可逆写入探针：Storage 上传 + stories INSERT，两步都会立刻删除 */
  async function writeProbe(st) {
    line('');
    line('--- 云端写入探针（测试数据会立即删除）---');
    if (!st || !st.client || !st.coupleId || !st.user) {
      line('需要「已登录 + 已解锁 + 已建空间」后才能测试，当前跳过。');
      return;
    }
    const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const path = st.coupleId + '/__diag__-' + id + '.txt';
    try {
      const up = await st.client.storage.from('story-audio')
        .upload(path, new Blob(['diag'], { type: 'text/plain' }), { contentType: 'text/plain', upsert: false });
      line('[Storage 上传] ' + (up.error ? '✗ ' + up.error.message : '✓ 成功'));
      if (!up.error) {
        const rm = await st.client.storage.from('story-audio').remove([path]);
        line('[Storage 删除] ' + (rm.error ? '✗ ' + rm.error.message : '✓ 成功'));
      }
    } catch (e) { line('[Storage 上传] ✗ ' + ((e && e.message) || e)); }

    try {
      const ins = await st.client.from('stories').insert({
        id: id, couple_id: st.coupleId, author_id: st.user.id,
        content_cipher: '__diag__', content_iv: '__diag__',
        audio_path: null, audio_iv: null, mime: 'audio/mpeg', duration: 0, byte_size: 0
      });
      line('[stories INSERT] ' + (ins.error ? '✗ ' + ins.error.message + ' (code ' + ins.error.code + ')' : '✓ 成功 ← 上传同步应该不会再失败'));
      if (ins.error && /permission denied/i.test(ins.error.message)) {
        line('  → 这是数据库列权限未补齐：请在 SQL Editor 执行 supabase/patch-grants.sql');
      }
      if (!ins.error) {
        const del = await st.client.from('stories').delete().eq('id', id);
        line('[stories 删除] ' + (del.error ? '✗ ' + del.error.message : '✓ 成功'));
      }
    } catch (e) { line('[stories INSERT] ✗ ' + ((e && e.message) || e)); }
  }

  async function run() {
    report = '';
    if (out()) out().textContent = '正在检测…';
    const { cfg, token, st } = await envSection();
    await networkSection(cfg, token);
    await dbSection(st);
    line('');
    line('=== 检测完成 ===');
    line('把以上内容复制给我即可；请在 WiFi 和移动数据下各跑一次做对比。');
    // 写入探针单独点按钮触发，避免每次诊断都产生云端写入
  }

  $('#acctDiagBtn').addEventListener('click', () => {
    $('#diagMask').hidden = false;
    run();
  });
  $('#diagCloseBtn').addEventListener('click', () => { $('#diagMask').hidden = true; });
  $('#diagMask').addEventListener('click', e => {
    if (e.target === $('#diagMask')) $('#diagMask').hidden = true;
  });
  $('#diagCopyBtn').addEventListener('click', async () => {
    const text = report;
    try {
      await navigator.clipboard.writeText(text);
      toast('诊断结果已复制');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('诊断结果已复制'); }
      catch (e2) { toast('复制失败，请长按选择文本'); }
      document.body.removeChild(ta);
    }
  });
  $('#diagForceBtn').addEventListener('click', async () => {
    toast('正在清除缓存…');
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.active) reg.active.postMessage({ type: 'FORCE_REFRESH' });
      }
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (e) {}
    setTimeout(() => location.reload(), 700);
  });
  $('#diagTestUploadBtn').addEventListener('click', async () => {
    const st = (typeof CloudSync !== 'undefined') ? CloudSync.state : null;
    $('#diagTestUploadBtn').disabled = true;
    await writeProbe(st);
    $('#diagTestUploadBtn').disabled = false;
    line('');
    line('=== 写入探针完成 ===');
  });
})();
