/* Service Worker — 配送中は電波が届かないことがあるので、
 * アプリ本体と依存はすべて事前にキャッシュして同一オリジンから配る。
 *
 * 取り出し方は2通りに分けている。
 *   vendor/ 配下   … バージョンを固定した外部ライブラリ。中身が変わらないのでキャッシュ優先
 *   それ以外       … アプリ本体。ネットワーク優先にして更新をすぐ届ける
 *                    （圏外ならキャッシュへ落ちるので、オフラインでも起動する）。
 *                    電波の弱い所では応答も失敗も返らないまま止まるので、
 *                    NETWORK_TIMEOUT で待つのをやめてキャッシュを返す
 *
 * tailwind.css は index.html のクラスから生成する = アプリ側の資産なので、
 * vendor/ ではなくルートに置く。vendor/ に置くとキャッシュ優先になり、
 * 画面を直しても古いスタイルが返り続ける。
 *
 * ファイルを足す・消すときは PRECACHE の一覧を更新する。
 * CACHE の版を上げると、次回オンラインで開いたときに古いキャッシュを丸ごと捨てる。
 */
const CACHE = 'nagata-nippo-v25';
const NETWORK_TIMEOUT = 3000;   // ms

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

// clone() は応答を返す前に呼ぶ。返した後は本文が読まれていて写せない
const putInCache = (req, res) => {
  if (!res || res.status !== 200 || res.type !== 'basic') return Promise.resolve();
  const copy = res.clone();
  return caches.open(CACHE).then((cache) => cache.put(req, copy));
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
      caches.match(req).then((hit) => hit || fetch(req).then((res) => { putInCache(req, res); return res; }))
    );
    return;
  }

  // アプリ本体はネットワーク優先。圏外ならすぐ、応答が遅ければ NETWORK_TIMEOUT でキャッシュへ落ちる。
  // 遅れて届いた応答もキャッシュへ入れて、次に開いたときに使う
  const network = fetch(req);
  event.waitUntil(network.then((res) => putInCache(req, res)).catch(() => {}));
  const fromCache = () => caches.match(req).then((hit) =>
    hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
  // キャッシュにも無ければネットワークを待ち続ける
  const slow = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT))
    .then(fromCache)
    .then((hit) => hit || network);
  event.respondWith(
    Promise.race([network, slow])
      .catch(() => fromCache().then((hit) => hit || Promise.reject(new Error('offline'))))
  );
});
