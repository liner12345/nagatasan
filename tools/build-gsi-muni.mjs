// vendor/gsi-muni.json を作る。国土地理院の逆ジオコーダは市区町村をコード（muniCd）でしか返さないので、
// 地理院地図が使っている対応表 muni.js からコード → 名前の表を起こす。
// キーは String(Number(code))。muni.js は "1100"、API は "01100" と、先頭の 0 の有無が揃っていない。
// 名前の空白（政令市の「大阪市　北区」）は除く。
// 使い方: npm run build:muni
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://maps.gsi.go.jp/js/muni.js';
const OUT = fileURLToPath(new URL('../vendor/gsi-muni.json', import.meta.url));

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`);
const text = await res.text();

const entries = [...text.matchAll(/GSI\.MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']*)';/g)];
if (!entries.length) throw new Error(`${SOURCE}: no GSI.MUNI_ARRAY entries`);

const table = {};
for (const [, key, value] of entries) {
    const [, , code, name] = value.split(',');
    const k = String(Number(key));
    if (String(Number(code)) !== k || !name) throw new Error(`unexpected entry: ${key} = ${value}`);
    if (k in table) throw new Error(`duplicate code: ${key}`);
    table[k] = name.replace(/\s/g, '');
}

writeFileSync(OUT, JSON.stringify(table, null, 1) + '\n');
console.log(`${OUT}: ${entries.length} municipalities`);
