/* 离线缓存：让「添加到主屏幕」之后断网也能打开。
   数据本身在 IndexedDB，与本缓存无关；这里只缓存界面外壳。
   改动界面后把 CACHE 版本号 +1，手机下次联网打开时会自动换新。 */
const CACHE = 'jizhang-v43';
/* 版本号同时用于给 localdb.js 加查询串：HTML 里的引用一变，
   旧 Service Worker 的缓存必然 miss，从而强制回源拿新代码。
   必须与 build_mobile.py::sw_ver() 提取的纯数字一致（?v=29），
   否则预缓存的是一个页面永远不会请求的无效 key。 */
const VER = CACHE.replace('jizhang-v', '');
/* 只预缓存「离线打开必需」的最小集：导航壳 + 数据层。
   图表库、图标、manifest 在首次联网使用时由下方 fetch 分支按需 cache.put，
   联网打开一次后离线同样完整可用。换代下载量从约 630KB 降到约 210KB，
   且不再与首屏导航请求抢带宽。 */
const CORE_ASSETS = [
  './',
  './localdb.js?v=' + VER
];

/* 导航请求的缓存键固定成 scope 根：不管页面被带上什么查询串打开，
   都命中同一份外壳，不会每次换 URL 就多存一份。 */
const NAV_KEY = './';

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 逐个写入并吞掉单个失败：addAll 是原子的，任一资源 404 或网络抖动
         都会让整个 install 失败，下次打开又从头重装（表现为每次都卡）。 */
      return Promise.all(CORE_ASSETS.map(function (url) {
        return c.add(url).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
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
    /* 页面外壳走缓存优先：本地有就先显示，打开是瞬时的；
       同时后台去取最新页面写回缓存，下次打开自然就是新版。
       换代靠 CACHE 版本号：新 SW 的 install 会预缓存新外壳、activate 清旧缓存，
       所以「缓存优先」不会让页面永久停在旧版。 */
    var pageNet = fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(NAV_KEY, copy); });
      }
      return res;
    });
    e.respondWith(
      caches.match(NAV_KEY).then(function (hit) {
        if (hit) {
          pageNet.catch(function () {});
          return hit;
        }
        /* 首次访问（缓存还没写入）或缓存被清：只能等网络，失败再回落到缓存 */
        return pageNet.catch(function () {
          return caches.match(NAV_KEY);
        });
      })
    );
    return;
  }

  /* 数据层同样缓存优先：它带着 ?v=版本号，换代时版本号一变 URL 就变，
     旧条目天然命中不到，所以不存在「拿到旧代码把账算错」的风险。
     后台静默更新保证同一版本内的小修也能在下次打开时生效。 */
  if (/\/localdb\.js$/.test(url.pathname)) {
    var dbNet = fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) {
          dbNet.catch(function () {});
          return hit;
        }
        return dbNet.catch(function () {
          return caches.match(req, { ignoreSearch: true });
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
