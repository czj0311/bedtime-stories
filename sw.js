/* 睡前故事 Service Worker
   策略：
   - 应用外壳（HTML/JS/CSS/manifest）：网络优先，失败才回退缓存。
     这样每次刷新都能拿到最新修复，避免 iOS 独立 PWA / 华为浏览器
     长期停留在旧版 config.js（空配置 → 仅本机模式 → 看似无法登录）。
   - 字体、图标：缓存优先（体积大、变化少、不阻塞首屏）。
   - js/config.js：强制 no-store，永不使用陈旧配置。
*/
const CACHE = 'bedtime-stories-v5';
const CORE = [
  './', './index.html', './styles.css',
  './js/1-util.js', './js/2-state.js', './js/3-ambient.js',
  './js/4-recorder.js', './js/5-canvas.js', './js/6-library.js',
  './js/7-player.js', './js/8-timer.js', './js/9-modals.js', './js/10-events.js',
  './js/11-crypto.js', './js/config.js', './js/12-cloud.js',
  './js/13-account.js', './js/14-diagnostics.js',
  './vendor/runtime.js',
  './assets/icon-192.png', './assets/icon-512.png',
  './manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(CORE.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 诊断面板的「强制更新」：清空全部缓存并重新预取 */
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'FORCE_REFRESH') return;
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => caches.open(CACHE))
      .then(c => Promise.allSettled(CORE.map(u => c.add(new Request(u, { cache: 'reload' })))))
  );
});

const isFontOrIcon = url => /fonts|assets\/icon-|woff2?(\?|$)/.test(url);
const isAppShell = req => {
  const u = new URL(req.url);
  if (u.origin !== location.origin) return false;
  return req.mode === 'navigate'
    || /\.(?:html|js|css|webmanifest)$/.test(u.pathname)
    || u.pathname.endsWith('/');
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // 字体 / 图标：缓存优先，后台更新
  if (isFontOrIcon(req.url)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return r;
      }))
    );
    return;
  }

  // 配置文件：永远走网络，绝不使用旧缓存
  if (/\/js\/config\.js$/.test(new URL(req.url).pathname)) {
    e.respondWith(
      fetch(new Request(req, { cache: 'no-store' }))
        .then(r => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return r;
        })
        .catch(() => caches.match(req).then(hit => hit || Response.error()))
    );
    return;
  }

  // 应用外壳：网络优先，成功即写回缓存；断网才回退缓存
  if (isAppShell(req)) {
    e.respondWith(
      fetch(req).then(r => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return r;
        }
        return caches.match(req).then(hit => hit || r);
      }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // 其它同源资源：缓存优先
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
