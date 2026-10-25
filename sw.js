/* 睡前故事 Service Worker：离线缓存，让 App 安装后可离线使用 */
const CACHE = 'bedtime-stories-v3';
const CORE = [
  './', './index.html', './styles.css',
  './js/1-util.js', './js/2-state.js', './js/3-ambient.js',
  './js/4-recorder.js', './js/5-canvas.js', './js/6-library.js',
  './js/7-player.js', './js/8-timer.js', './js/9-modals.js', './js/10-events.js',
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

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // 字体：网络优先，失败回退缓存
  if (/fonts/.test(req.url)) {
    e.respondWith(
      fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 其余同源资源：缓存优先，后台更新
  e.respondWith(
    caches.match(req).then(hit => {
      const fetching = fetch(req).then(r => {
        if (r.ok && new URL(req.url).origin === location.origin) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return r;
      }).catch(() => null);
      return hit || fetching.then(r => r || caches.match('./index.html'));
    })
  );
});
