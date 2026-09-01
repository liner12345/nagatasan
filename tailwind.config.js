/** Tailwind の生成設定。
 *  生成物 vendor/tailwind.css はコミットしているので、配信にビルドは要らない。
 *  index.html のクラスを足したときだけ `npm run build:css` で作り直す。 */
module.exports = {
  content: ['./index.html', './app.js'],
  theme: { extend: {} },
  plugins: []
};
