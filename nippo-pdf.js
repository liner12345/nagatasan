/* 日報 PDF — 自動記帳キットを通さず、アプリだけで日報様式の PDF を作る。
 *
 * 様式の実体は 自動記帳キット/fmt.py の build_nippo(A1:H37)。ここはその写しで、
 * 列幅・行高・罫線・塗り・書式を同じ比率で canvas に描き、画像1枚の PDF に包む。
 * 仕様は ok-report/docs/format-spec.md §4.7。
 *
 * 文字は画像になる（PDF 内で選択・検索はできない）。日本語フォントを埋め込まずに
 * 済ませるための割り切りで、これによりライブラリも追加フォントも要らない。
 *
 * 運賃計算 fareParts() は fmt.fare_parts() の移植。**運賃の実装はこれで3か所目**
 * （日報の数式 / fare_parts / ここ）。片方だけ直すと金額が食い違う。
 * 変えるときは state-machines.md SM-6 の組を全部変え、
 * tests/test_fare_parity.py を通すこと。
 */
(function (global) {
    'use strict';

    // ───────── 様式（build_nippo と対で管理する） ─────────

    // 列幅は Excel の文字単位。Excel の実幅 px = 文字数*7+5、pt = px*0.75
    const COL_CHARS = [6.5, 11, 20, 9, 9, 9, 9, 16];          // A〜H
    const COL_W = COL_CHARS.map((w) => (w * 7 + 5) * 0.75);   // pt
    const FORM_W = COL_W.reduce((a, b) => a + b, 0);          // 499.875pt

    const ROWS = 37;
    const ROW_H_DEFAULT = 17.5;   // 参照PDFから較正。build_nippo は既定値を触らない
    const ROW_H_CASE = 20;        // build_nippo が rows 9-16 に明示している値
    const rowH = (r) => (r >= 9 && r <= 16 ? ROW_H_CASE : ROW_H_DEFAULT);

    const FORM_H = (function () {
        let h = 0;
        for (let r = 1; r <= ROWS; r++) h += rowH(r);
        return h;                                              // 667.5pt
    })();

    // 用紙。Excel の既定余白（左右 0.7in / 上下 0.75in）と fitToWidth=1 に合わせる
    const PAGE_W = 595.276, PAGE_H = 841.89;                   // A4 縦
    const MARGIN_X = 50.4, MARGIN_Y = 54;
    const SCALE = Math.min(1, (PAGE_W - MARGIN_X * 2) / FORM_W,
                              (PAGE_H - MARGIN_Y * 2) / FORM_H);

    const DPI = 200;
    const CELL_PAD = 2;           // Excel の既定の左右余白（pt）

    const YELLOW = '#FFF3C4';
    const HEAD_FILL = '#E8EEF4';
    const THIN = '#B0B0B0';
    const MEDIUM = '#404040';
    const GRAY = '#707070';
    const RED = '#FF0000';
    const FONT_STACK = '"游ゴシック", YuGothic, "Hiragino Sans", ' +
                       '"Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';

    const KIHON = 5000;           // 基本運賃。build_nippo が C29 に入れる既定値
    const OWNER = 'オーケーサービス';   // build_nippo の H2
    const MAX_CASES = 8;          // 明細は 9〜16 行の8件まで（01_nippo.py と同じ）

    // ───────── 運賃（fmt.fare_parts の移植） ─────────

    const num = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
    const isBlank = (x) => (x === null || x === undefined || x === '' ||
                            (typeof x === 'number' && !isFinite(x)));

    /** 入力欄から来た文字列を数値にする。空欄は null（0 と区別する） */
    function toNum(x) {
        if (isBlank(x)) return null;
        const v = Number(x);
        return isFinite(v) ? v : null;
    }

    /** Python の round() と同じ偶数丸め。freeze_nippo_formulas が C34 に使う */
    function roundHalfEven(v) {
        const f = Math.floor(v);
        const d = v - f;
        if (d > 0.5) return f + 1;
        if (d < 0.5) return f;
        return f % 2 === 0 ? f : f + 1;
    }

    function fareParts(km, kaisyuKm, hako, shoku, tsuika, taiki, kaki, kihon) {
        const kyori = num(km) <= 20 ? 0 : 200 * (num(km) - 20);
        let kaisyu;
        if (isBlank(kaisyuKm)) {
            kaisyu = 0;
        } else {
            kaisyu = (kaisyuKm <= 10 ? 2000 : 2000 + 200 * (kaisyuKm - 10)) +
                     (num(hako) >= 1 ? hako * 100 : 0);
        }
        const e21 = num(shoku) < 100 ? 0 : 1000 + 500 * Math.trunc((shoku - 100) / 50);
        const e22 = isBlank(tsuika) ? 0 : tsuika * 500;
        const e23 = num(taiki) < 20 ? 0 : 500 + Math.trunc((taiki - 20) / 20) * 500;
        const e24 = num(kaki);
        const sagyo = e21 + e22 + e23 + e24;
        const subtotal = num(kihon) + kyori + kaisyu + sagyo;
        return {
            kyori: kyori, kaisyu: kaisyu,
            e21: e21, e22: e22, e23: e23, e24: e24, sagyo: sagyo,
            waribiki: subtotal * -0.1, total: subtotal + subtotal * -0.1
        };
    }

    // ───────── 書式 ─────────

    /** 住所 → 市町村（B列）。01_nippo.py の city_of の移植 */
    function cityOf(addr) {
        if (!addr) return '';
        let m = /^(?:.*?[市])?\s*(.*?[区])/.exec(addr);
        if (m && m[1]) return m[1];
        m = /^(.*?[市町村])/.exec(addr);
        return m ? m[1] : addr.slice(0, 6);
    }

    /** #,##0 */
    const money = (v) => Math.round(v).toLocaleString('en-US');

    /** 'HH:MM' → 'H:MM'（Excel の h:mm） */
    function hmm(s) {
        const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
        return m ? String(Number(m[1])) + ':' + m[2] : '';
    }

    /** '2026/08/29(土)' → '8月29日(土)'（Excel の m"月"d"日"(aaa)） */
    function nippoDate(dateStr) {
        const m = /^(\d{4})\/(\d{2})\/(\d{2})(?:\((.)\))?/.exec(dateStr || '');
        if (!m) return dateStr || '';
        const w = m[4] ? '(' + m[4] + ')' : '';
        return Number(m[2]) + '月' + Number(m[3]) + '日' + w;
    }

    /** キットと同じファイル名（format-spec §5）。同日2運行目の (2) は付けられない */
    function fileName(dateStr) {
        const m = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(dateStr || '');
        if (!m) return '日報.pdf';
        return '日報_' + Number(m[1]) + '年' + Number(m[2]) + '月_' +
               Number(m[2]) + '月' + Number(m[3]) + '日.pdf';
    }

    // ───────── 描画 ─────────

    function colLeft(c) {                 // c は 1..8
        let x = 0;
        for (let i = 0; i < c - 1; i++) x += COL_W[i];
        return x;
    }
    function rowTop(r) {
        let y = 0;
        for (let i = 1; i < r; i++) y += rowH(i);
        return y;
    }

    /** canvas に日報1枚を描く。戻り値は canvas */
    function render(data) {
        const px = (pt) => pt * DPI / 72;
        const cv = global.document.createElement('canvas');
        cv.width = Math.round(px(PAGE_W));
        cv.height = Math.round(px(PAGE_H));
        const g = cv.getContext('2d');

        g.fillStyle = '#FFFFFF';
        g.fillRect(0, 0, cv.width, cv.height);

        // 用紙上の座標 → canvas の画素。様式は左上そろえで幅に合わせて縮む
        const X = (ptX) => px(MARGIN_X + ptX * SCALE);
        const Y = (ptY) => px(MARGIN_Y + ptY * SCALE);

        const cellBox = (r, c, span) => {
            const x0 = colLeft(c);
            let w = COL_W[c - 1];
            for (let i = 1; i < (span || 1); i++) w += COL_W[c - 1 + i];
            return { x: X(x0), y: Y(rowTop(r)), w: X(x0 + w) - X(x0),
                     h: Y(rowTop(r) + rowH(r)) - Y(rowTop(r)) };
        };

        function fill(r, c, color) {
            const b = cellBox(r, c);
            g.fillStyle = color;
            g.fillRect(b.x, b.y, b.w, b.h);
        }

        function box(r, c, color, widthPt) {
            const b = cellBox(r, c);
            g.strokeStyle = color || THIN;
            g.lineWidth = px((widthPt || 0.5) * SCALE);
            g.strokeRect(b.x, b.y, b.w, b.h);
        }

        function line(r, c, edge, color, widthPt) {
            const b = cellBox(r, c);
            g.strokeStyle = color;
            g.lineWidth = px(widthPt * SCALE);
            g.beginPath();
            const y = edge === 'top' ? b.y : b.y + b.h;
            g.moveTo(b.x, y);
            g.lineTo(b.x + b.w, y);
            g.stroke();
        }

        /* セルに文字を置く。
         * opt: {size, bold, color, align:'l'|'c'|'r', valign:'b'|'m', span, overflow}
         * overflow が偽なら、はみ出す文字は 70% まで縮めてから切る。Excel は隣が空なら
         * あふれさせるが、明細が隣の列に重なると読めなくなるため縮める側に寄せた。 */
        function text(r, c, str, opt) {
            if (str === '' || str === null || str === undefined) return;
            const o = opt || {};
            const b = cellBox(r, c, o.span);
            const sizePt = (o.size || 10) * SCALE;
            let fontPx = px(sizePt);
            const setFont = () => {
                g.font = (o.bold ? 'bold ' : '') + fontPx.toFixed(2) + 'px ' + FONT_STACK;
            };
            setFont();
            const pad = px(CELL_PAD * SCALE);
            const avail = b.w - pad * 2;
            if (!o.overflow && g.measureText(str).width > avail) {
                const shrink = Math.max(0.7, avail / g.measureText(str).width);
                fontPx *= shrink;
                setFont();
            }
            g.fillStyle = o.color || '#000000';
            let x;
            if (o.align === 'c') { g.textAlign = 'center'; x = b.x + b.w / 2; }
            else if (o.align === 'r') { g.textAlign = 'right'; x = b.x + b.w - pad; }
            else { g.textAlign = 'left'; x = b.x + pad; }
            let y;
            if (o.valign === 'm') { g.textBaseline = 'middle'; y = b.y + b.h / 2; }
            else { g.textBaseline = 'alphabetic'; y = b.y + b.h - fontPx * 0.25; }
            g.save();
            if (!o.overflow) {
                g.beginPath();
                g.rect(b.x, b.y, b.w, b.h);
                g.clip();
            }
            g.fillText(str, x, y);
            g.restore();
        }

        const d = normalize(data);
        const v = values(d);

        // 1行目 タイトル（centerContinuous = A1:H1 の中央）
        text(1, 1, '永田商店　お弁当配送　日報',
             { size: 14, bold: true, align: 'c', span: 8, overflow: true });

        // 2行目 取引先 / 屋号
        text(2, 1, '取引先', { size: 10, bold: true });
        fill(2, 3, YELLOW); box(2, 3, THIN);
        text(2, 3, d.client, { size: 10, bold: true });
        text(2, 8, OWNER, { size: 9, color: GRAY, align: 'r', overflow: true });

        // 3〜6行目 見出しブロック
        const labels = [[3, 1, '日付'], [3, 5, '名前'], [3, 7, '車番'],
                        [4, 1, '出発'], [4, 5, '出発時刻'],
                        [5, 1, '終了'], [5, 5, '終了時刻'], [6, 1, '当日走行距離']];
        // 隣（B列 / F列）が空なので Excel と同じくあふれさせる。
        // 縮めると「当日走行距離」が A列に収まらず切れる
        labels.forEach((L) => text(L[0], L[1], L[2], { size: 10, bold: true, overflow: true }));

        [[3, 3], [3, 6], [3, 8], [4, 3], [4, 6], [5, 3], [5, 6]].forEach((p) => {
            fill(p[0], p[1], YELLOW); box(p[0], p[1], THIN);
        });
        box(6, 3, THIN);

        text(3, 3, nippoDate(d.dateStr), { size: 10, align: 'c' });
        text(3, 6, d.driverName, { size: 10 });
        text(3, 8, d.vehicleNo, { size: 10 });
        text(4, 3, v.startMileage === null ? '' : money(v.startMileage), { size: 10, align: 'r' });
        text(5, 3, v.endMileage === null ? '' : money(v.endMileage), { size: 10, align: 'r' });
        text(6, 3, v.km === null ? '' : money(v.km), { size: 10, align: 'r' });
        text(4, 6, hmm(d.startTime), { size: 10, align: 'c' });
        text(5, 6, hmm(d.endTime), { size: 10, align: 'c' });
        [4, 5, 6].forEach((r) => text(r, 4, '㎞', { size: 10 }));

        // 8行目 見出し
        const heads = ['No', '市町村', '配送先', '到着', '出発', '支払', '着距離㎞', '備考'];
        heads.forEach((h, i) => {
            fill(8, i + 1, HEAD_FILL);
            box(8, i + 1, THIN);
            text(8, i + 1, h, { size: 10, bold: true, align: 'c', valign: 'm' });
        });

        // 9〜16行 明細
        for (let i = 0; i < MAX_CASES; i++) {
            const r = 9 + i;
            for (let c = 1; c <= 8; c++) box(r, c, THIN);
            const cs = d.cases[i];
            const city = cs ? cityOf(cs.address) : '';
            // A列の No は build_nippo と同じ規則。9〜13行は常に、14行以降は B列があるときだけ
            if (r <= 13 || city) text(r, 1, String(i + 1), { size: 10, align: 'c', valign: 'm' });
            if (!cs) continue;
            text(r, 2, city, { size: 10, valign: 'm' });
            text(r, 3, cs.destination, { size: 10, valign: 'm' });
            text(r, 4, hmm(cs.arrTime), { size: 10, align: 'c', valign: 'm' });
            text(r, 5, hmm(cs.depTime), { size: 10, align: 'c', valign: 'm' });
            text(r, 6, cs.payment, { size: 10, valign: 'm' });
            text(r, 7, cs.mileage ? String(cs.mileage) : '', { size: 10, align: 'c', valign: 'm' });
            text(r, 8, cs.remarks, { size: 10, valign: 'm' });
        }

        // 18〜26行 当日実績
        text(18, 1, '【当日実績】', { size: 10, bold: true, overflow: true });
        text(18, 5, '金額(自動)', { size: 8, color: GRAY, align: 'c', overflow: true });
        const jisseki = [
            [19, '①回収距離', '㎞', v.daily.kaisyuKm, null],
            [20, '①回収箱数', '箱', v.daily.hako, null],
            [21, '②配達数', '食', v.daily.shoku, v.fare.e21],
            [22, '③追加配達', '件', v.daily.tsuika, v.fare.e22],
            [23, '④作業・待機', '分', v.daily.taiki, v.fare.e23],
            [24, '⑤夏季手当', '円', v.daily.kaki, v.fare.e24],
            [25, '高速料(立替)', '円', v.toll, null],
            [26, '駐車料(立替)', '円', v.park, null]
        ];
        jisseki.forEach((row) => {
            const r = row[0];
            text(r, 1, row[1], { size: 10, overflow: true });
            fill(r, 3, YELLOW); box(r, 3, THIN);
            if (row[3] !== null) text(r, 3, money(row[3]), { size: 10, align: 'r' });
            text(r, 4, row[2], { size: 9, color: GRAY });
            if (row[4] !== null) {
                box(r, 5, THIN);
                if (row[4]) text(r, 5, money(row[4]), { size: 10, align: 'r' });
            }
        });

        // 28〜35行 運賃計算
        text(28, 1, '【運賃計算(自動)】', { size: 10, bold: true, overflow: true });
        const calc = [
            [29, '基本運賃', v.kihon],
            [30, '距離料金', v.fare.kyori || null],
            [31, '回収料金', v.fare.kaisyu || null],
            [32, '作業料金(②〜⑤)', v.fare.sagyo || null],
            [33, '▲割引(10%)', v.fare.waribiki],
            [34, '合計', v.total],
            [35, '立替金合計', v.tatekae || null]
        ];
        calc.forEach((row) => {
            const r = row[0], big = r === 34;
            text(r, 1, row[1], { size: big ? 12 : 10, bold: big, overflow: true });
            if (r === 29) fill(r, 3, YELLOW);
            if (big) {
                line(r, 3, 'top', MEDIUM, 1.2);
                line(r, 3, 'bottom', MEDIUM, 1.2);
            } else {
                box(r, 3, THIN);
            }
            if (row[2] !== null) {
                const neg = row[2] < 0;
                text(r, 3, (neg ? '-' : '') + money(Math.abs(row[2])),
                     { size: big ? 12 : 10, bold: big, align: 'r', color: neg ? RED : '#000000' });
            }
            text(r, 4, '円', { size: 9, color: GRAY });
        });

        text(37, 1, '■ 黄色のセルが記入欄です。白いセルは自動計算されます。',
             { size: 8.5, color: GRAY, overflow: true });

        return cv;
    }

    /** 入力を整える。数値になるものは数値に、空欄は null に */
    function normalize(data) {
        const d = data || {};
        const src = d.daily || {};
        const daily = {};
        ['kaisyuKm', 'hako', 'shoku', 'tsuika', 'taiki', 'kaki'].forEach((k) => {
            daily[k] = toNum(src[k]);
        });
        return {
            client: d.client || '永田商店',
            dateStr: d.dateStr || '',
            driverName: d.driverName || '',
            vehicleNo: d.vehicleNo == null ? '' : String(d.vehicleNo),
            startMileage: toNum(d.startMileage),
            endMileage: toNum(d.endMileage),
            startTime: d.startTime || '',
            endTime: d.endTime || '',
            cases: (d.cases || []).slice(0, MAX_CASES),
            daily: daily,
            toll: toNum(d.toll),
            park: toNum(d.park)
        };
    }

    /** 表示する値。freeze_nippo_formulas と同じ規則（0 は空欄、合計は偶数丸め） */
    function values(d) {
        const km = (d.startMileage !== null && d.endMileage !== null)
            ? d.endMileage - d.startMileage : null;
        const fare = fareParts(km, d.daily.kaisyuKm, d.daily.hako, d.daily.shoku,
                               d.daily.tsuika, d.daily.taiki, d.daily.kaki, KIHON);
        const tatekae = num(d.toll) + num(d.park);
        return {
            startMileage: d.startMileage, endMileage: d.endMileage, km: km,
            daily: d.daily, toll: d.toll, park: d.park,
            kihon: KIHON, fare: fare,
            total: roundHalfEven(fare.total),
            tatekae: tatekae || null
        };
    }

    // ───────── PDF（画像1枚。ライブラリを使わずに組む） ─────────

    /** canvas の中身を RGB の並びで少しずつ流す。1枚ぶんを一度に持たないため */
    function rgbStream(g, w, h) {
        const BAND = 256;
        let y = 0;
        return new global.ReadableStream({
            pull: function (ctrl) {
                if (y >= h) { ctrl.close(); return; }
                const bh = Math.min(BAND, h - y);
                const src = g.getImageData(0, y, w, bh).data;
                const out = new Uint8Array(w * bh * 3);
                for (let i = 0, j = 0; j < out.length; i += 4, j += 3) {
                    out[j] = src[i]; out[j + 1] = src[i + 1]; out[j + 2] = src[i + 2];
                }
                ctrl.enqueue(out);
                y += bh;
            }
        });
    }

    /** 可逆（FlateDecode）で取れなければ JPEG（DCTDecode）へ落ちる */
    async function encodeImage(cv) {
        if (typeof global.CompressionStream === 'function' &&
            typeof global.ReadableStream === 'function') {
            try {
                const g = cv.getContext('2d');
                const stream = rgbStream(g, cv.width, cv.height)
                    .pipeThrough(new global.CompressionStream('deflate'));
                const buf = await new global.Response(stream).arrayBuffer();
                return { bytes: new Uint8Array(buf), filter: '/FlateDecode' };
            } catch (e) {
                // 端末の対応や記憶域の都合で落ちることがある。JPEG に切り替える
                console.warn('deflate failed, falling back to JPEG', e);
            }
        }
        const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.92));
        if (!blob) throw new Error('画像に変換できませんでした。');
        return { bytes: new Uint8Array(await blob.arrayBuffer()), filter: '/DCTDecode' };
    }

    function assemblePdf(img, w, h) {
        const enc = new TextEncoder();
        const parts = [];
        let len = 0;
        const put = (u8) => { parts.push(u8); len += u8.length; };
        const puts = (s) => put(enc.encode(s));
        const offset = [];

        put(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, 0x0A,
                            0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));   // %PDF-1.4 + binary marker

        const obj = (n, body) => { offset[n] = len; puts(n + ' 0 obj\n' + body + '\nendobj\n'); };

        obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
        obj(3, '<< /Type /Page /Parent 2 0 R ' +
               '/MediaBox [0 0 ' + PAGE_W.toFixed(2) + ' ' + PAGE_H.toFixed(2) + '] ' +
               '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');

        offset[4] = len;
        puts('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h +
             ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ' + img.filter +
             ' /Length ' + img.bytes.length + ' >>\nstream\n');
        put(img.bytes);
        puts('\nendstream\nendobj\n');

        const content = 'q ' + PAGE_W.toFixed(2) + ' 0 0 ' + PAGE_H.toFixed(2) +
                        ' 0 0 cm /Im0 Do Q\n';
        obj(5, '<< /Length ' + enc.encode(content).length + ' >>\nstream\n' +
               content + 'endstream');
        obj(6, '<< /Producer (nagatasan nippo) >>');

        const xref = len;
        let table = 'xref\n0 7\n0000000000 65535 f \n';
        for (let n = 1; n <= 6; n++) {
            table += String(offset[n]).padStart(10, '0') + ' 00000 n \n';
        }
        puts(table);
        puts('trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

        return new Blob(parts, { type: 'application/pdf' });
    }

    /** data から PDF を作る。{ blob, name } を返す */
    async function buildPdf(data) {
        const cv = render(data);
        const img = await encodeImage(cv);
        return { blob: assemblePdf(img, cv.width, cv.height), name: fileName((data || {}).dateStr) };
    }

    global.NippoForm = {
        fareParts: fareParts,
        roundHalfEven: roundHalfEven,
        cityOf: cityOf,
        nippoDate: nippoDate,
        fileName: fileName,
        render: render,
        buildPdf: buildPdf,
        KIHON: KIHON,
        MAX_CASES: MAX_CASES
    };
})(typeof window !== 'undefined' ? window : globalThis);
