/* 离线缓存：让「添加到主屏幕」之后断网也能打开。
   数据本身在 IndexedDB，与本缓存无关；这里只缓存界面外壳。
   改动界面后把 CACHE 版本号 +1，手机下次联网打开时会自动换新。 */
const CACHE = 'jizhang-v65';
/* 版本号同时用于给 localdb.js 加查询串：HTML 里的引用一变，
   旧 Service Worker 的缓存必然 miss，从而强制回源拿新代码。
   必须与 build_mobile.py::sw_ver() 提取的纯数字一致（?v=29），
   否则预缓存的是一个页面永远不会请求的无效 key。 */
const VER = CACHE.replace('jizhang-v', '');
/* 跨版本共用的静态资源缓存：文件名带内容哈希（app.*.js）或长期不变
   （图表库、图标、manifest），换代时不该重下。
   以前它们被放在版本缓存里，activate 一清就得重新下载 330KB，
   首屏还要等阻塞脚本下载完才出内容，表现为「打开变慢 / 一直加载」。 */
const STATIC = 'jizhang-assets-v1';

/* 导航请求的缓存键固定成 scope 根：不管页面被带上什么查询串打开，
   都命中同一份外壳，不会每次换 URL 就多存一份。 */
const NAV_KEY = './';

/* 跟着外壳一起预缓存的静态资源：体积大或每次都要用。 */
const STATIC_ASSETS = [
  './lib/chart.umd.min.js',
  './avatar-180.png',
  './avatar-512.png',
  './manifest.webmanifest'
];

/* 这些文件名不带内容哈希：换了图标或 manifest，URL 却没变，
   必须每次换代强制重取，否则主屏幕会一直显示旧图标。 */
const FRESH_ASSETS = ['avatar-180.png', 'avatar-512.png', 'manifest.webmanifest'];

function abs(p){ return new URL(p, self.registration.scope).href; }

/* 页面里引用的内容哈希脚本（app.<hash>.js）：名字变了才需要重新下载。 */
function appScriptOf(html){
  var m = /src="(app\.[A-Za-z0-9]+\.js)"/.exec(html || '');
  return m ? m[1] : '';
}

/* 旧版本缓存里还有的资源先搬过来：升级到本版时不必重新下载图表库那 200KB。 */
function pickFromOld(url){
  return caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return /^jizhang-v\d+$/.test(k);
    }).map(function (k) {
      return caches.open(k).then(function (c) { return c.match(url); })
        .then(function (r) { return r || null; })
        .catch(function () { return null; });
    }));
  }).then(function (list) {
    for (var i = 0; i < list.length; i++) if (list[i]) return list[i];
    return null;
  }).catch(function () { return null; });
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 外壳与数据层一起写入新版本缓存。逐个 add 并吞掉失败：addAll 是原子的，
         任一资源 404 或网络抖动都会让整个 install 失败，下次打开又从头重装。 */
      return Promise.all([
        c.add(abs('./')).catch(function () { return null; }),
        c.add(abs('./localdb.js?v=' + VER)).catch(function () { return null; })
      ]).then(function () { return c.match(NAV_KEY); });
    }).then(function (res) {
      return res ? res.text() : '';
    }).then(function (html) {
      /* 顺着新外壳把它引用的 app.<hash>.js 一起取下来，HTML 与脚本同时就位，
         不会出现「页面已经是新版、脚本还在下载」的空窗。 */
      var list = STATIC_ASSETS.slice();
      var app = appScriptOf(html);
      if (app) list.push('./' + app);
      return caches.open(STATIC).then(function (c) {
        /* 已经有的就不重复下载：图表库 200KB 只在下一次内容变化时才会重取；
           旧版本缓存里有的（升级场景）直接搬过来，不再走网络。 */
        return Promise.all(list.map(function (p) {
          var url = abs(p);
          var name = p.replace(/^\.\//, '');
          if (FRESH_ASSETS.indexOf(name) >= 0) {
            return c.add(url).catch(function () { return null; });
          }
          return c.match(url).then(function (hit) {
            if (hit) return null;
            return pickFromOld(url).then(function (old) {
              if (old) return c.put(url, old);
              return c.add(url).catch(function () { return null; });
            });
          });
        }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      /* 只清本应用的旧版本缓存，跨版本的静态缓存和其它站点数据一律不碰 */
      return Promise.all(keys.map(function (k) {
        if (k === CACHE || k === STATIC) return null;
        return /^jizhang-v\d+$/.test(k) ? caches.delete(k) : null;
      }));
    }).then(function () {
      /* 静态缓存里的旧 app.*.js 留着没用（文件名带哈希，永远命中同一个），
         只保留当前外壳引用的那个，避免每发一版多占 130KB。 */
      return caches.open(CACHE).then(function (c) { return c.match(NAV_KEY); })
        .then(function (res) { return res ? res.text() : ''; })
        .then(function (html) {
          var keep = appScriptOf(html);
          if (!keep) return null; /* 没读到外壳就保守跳过清理 */
          keep = abs('./' + keep);
          return caches.open(STATIC).then(function (c) {
            return c.keys().then(function (reqs) {
              return Promise.all(reqs.map(function (r) {
                if (/\/app\.[A-Za-z0-9]+\.js$/.test(r.url) && r.url !== keep) return c.delete(r);
                return null;
              }));
            });
          });
        });
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  /* 版本探测请求（?probe=时间戳）只用于「问服务器现在是什么版本」，
     不写缓存，否则每点一次检查更新就往静态缓存里塞一份 HTML。 */
  if (url.search.indexOf('probe=') >= 0) return;

  if (req.mode === 'navigate') {
    /* 外壳只由 install 写入版本缓存，这里不再「后台把网络结果写回」：
       否则旧版本装着的时候会把新版本 HTML 写进旧缓存，出现
       「HTML 是新的、它引用的 app.js 还没下载」的半更新，首屏会一直等脚本。
       换版完全交给 SW 生命周期：新版本 install 时外壳与 app.js 一起就位。 */
    e.respondWith(
      caches.match(NAV_KEY).then(function (hit) {
        return hit || fetch(req);
      })
    );
    return;
  }

  /* 数据层同样缓存优先：它带着 ?v=版本号，换代时版本号一变 URL 就变，
     旧条目天然命中不到，所以不存在「拿到旧代码把账算错」的风险。 */
  if (/\/localdb\.js$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req);
      })
    );
    return;
  }

  /* 其余静态资源（app.js、图表库、图标）：命中就用，没命中取回来放进
     跨版本缓存，下一次换代不用重下。 */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(STATIC).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
