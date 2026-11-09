/* Service Worker — 配送中は電波が届かないことがあるので、
 * アプリ本体と依存はすべて事前にキャッシュして同一オリジンから配る。
 *
 * 取り出し方は2通りに分けている。
 *   vendor/ 配下   … バージョンを固定した外部ライブラリ。中身が変わらないのでキャッシュ優先
 *   それ以外       … アプリ本体。ネットワーク優先にして更新をすぐ届ける
 *                    （圏外ならキャッシュへ落ちるので、オフラインでも起動する）
 *
 * tailwind.css は index.html のクラスから生成する = アプリ側の資産なので、
 * vendor/ ではなくルートに置く。vendor/ に置くとキャッシュ優先になり、
 * 画面を直しても古いスタイルが返り続ける。
 *
 * ファイルを足す・消すときは PRECACHE の一覧を更新する。
 * CACHE の版を上げると、次回オンラインで開いたときに古いキャッシュを丸ごと捨てる。
 */
const CACHE = 'nagata-nippo-v17';

const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './nippo-pdf.js',
  './style.css',
  './tailwind.css',
  './manifest.json',
  './favicon.svg',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './apple-touch-icon.png',
  './vendor/vue.global.prod.js',
  './vendor/gsi-muni.json',
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
      // 消すのは自分の古い版だけ。Cache Storage はオリジン単位なので、
      // 同じ liner12345.github.io にあるhamanippo のキャッシュ（nippou-v*）も見えている
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('nagata-nippo-') && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const putInCache = (req, res) => {
  if (res && res.status === 200 && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((cache) => cache.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 逆ジオコーディング(国土地理院)などの外部リクエストは素通し。
  // 住所は現在地ごとに変わるのでキャッシュしても当たらないうえ、古い住所を返すと害になる
  if (url.origin !== self.location.origin) return;

  // 固定バージョンの資産はキャッシュ優先
  if (url.pathname.includes('/vendor/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => putInCache(req, res)))
    );
    return;
  }

  // アプリ本体はネットワーク優先。圏外ならキャッシュへ落ちる
  event.respondWith(
    fetch(req)
      .then((res) => putInCache(req, res))
      .catch(() => caches.match(req).then((hit) =>
        hit || (req.mode === 'navigate' ? caches.match('./index.html') : Promise.reject(new Error('offline')))
      ))
  );
});
