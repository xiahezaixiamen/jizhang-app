/* 离线缓存：让「添加到主屏幕」之后断网也能打开。
   数据本身在 IndexedDB，与本缓存无关；这里只缓存界面外壳。
   改动界面后把 CACHE 版本号 +1，手机下次联网打开时会自动换新。 */
const CACHE = 'jizhang-v26';
/* 版本号同时用于给 localdb.js 加查询串：HTML 里的引用一变，
   旧 Service Worker 的缓存必然 miss，从而强制回源拿新代码。
   否则「缓存优先」会让改过的 JS 一直不生效。 */
const VER = CACHE.replace('jizhang-', '');
const ASSETS = [
  './',
  './index.html',
  './localdb.js?v=' + VER,
  './manifest.webmanifest',
  './lib/chart.umd.min.js',
  './icon-180.png',
  './icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  /* 数据层走网络优先：这是决定账目算得对不对的代码，
     联网时必须拿最新的，只有离线才回落到缓存。 */
  if (/\/localdb\.js$/.test(url.pathname)) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match(req, { ignoreSearch: true });
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
