/* Service Worker — 配送中は電波が届かないことがあるので、
 * アプリ本体と依存はすべて事前にキャッシュして同一オリジンから配る。
 *
 * ファイルを足す・消すときは PRECACHE の一覧と CACHE の版を必ず一緒に更新する。
 * 版を上げないと古いキャッシュが残り続ける。
 */
const CACHE = 'nagata-nippo-v1';

const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './favicon.svg',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './apple-touch-icon.png',
  './vendor/vue.global.prod.js',
  './vendor/tailwind.css',
  './vendor/fontawesome/css/all.min.css',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2',
  './vendor/fontawesome/webfonts/fa-regular-400.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 1件でも失敗すると addAll 全体が落ちるので、個別に入れて取りこぼしを許容する
      .then((cache) => Promise.all(PRECACHE.map((url) =>
        cache.add(url).catch((e) => console.warn('precache skipped:', url, e))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 逆ジオコーディング(Nominatim)などの外部リクエストは素通し。
  // 住所は現在地ごとに変わるのでキャッシュしても当たらないうえ、古い住所を返すと害になる
  if (url.origin !== self.location.origin) return;

  // 画面遷移はネットワークを先に試し、圏外ならキャッシュの index.html を返す
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // それ以外の同一オリジン資産はキャッシュ優先。取れたものは次回のために保存する
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
      }
      return res;
    }))
  );
});
