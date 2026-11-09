# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed
- The app is now called **永田日報** — the document title, the header, the manifest
  `name`/`short_name`, and a new `apple-mobile-web-app-title` so iOS uses it for the home
  screen too. It was "スマホ日報 - Smart Log Ultimate V3.9" / "配送日報 Pro".
  **An icon already on the home screen keeps its old name until it is removed and re-added.**
- The buttons at the top of the screen are at least 44px tall: 戻る/トップへ and 閉じる in
  the header, and 編集/保存, 中止 and 戻る on the report screen. They were 20–30px, small
  enough to miss or to hit the neighbour.
- Opening the app on a weak signal no longer waits on the network forever. The service
  worker still asks the network first for the app's own files, but gives up after 3 s and
  serves the cached copy. A response that arrives later still updates the cache, so the
  next launch gets it. Only `nagata-nippo-*` caches are ever deleted, as before.
- 到着 opens the meter screen at once. It used to sit behind "位置情報を取得中..." until the
  position and the address were both in, up to 20 s on a poor fix. The time is taken when
  the button is pressed; the position and the address are fetched in the background and
  fill the address field when they arrive ("測位中 ±Nm" shows meanwhile).
  - Recording the meter before the address is in is fine. The arrival is stored with
    `住所取得エラー` and gets the address as soon as it arrives. It goes only into that
    arrival: if the arrival was undone in the meantime, nothing is written.
  - If the app is reloaded while the address is still on its way, the arrival keeps
    `住所取得エラー`, a value the backup JSON already allows. No in-between value such as
    "取得中" is ever saved.
  - An address typed by hand is never overwritten.
  - The input screens are never saved as the current screen, even when the background work
    saves the run while one is open; a reload always comes back to the dashboard.
- The arrival screen has a "測り直す" button that takes the position and the address again,
  for a fix that landed on the wrong side of a boundary. The GPS error badge stays.
- The nearby destinations under the address ("近く:") can be tapped. Tapping one picks it
  as this case's destination, exactly like picking it on the 完了 screen, and the 完了
  screen then opens with it filled in.

### Added
- A "金額を手直し" panel on the report screen. The fare has always been computed from the
  day's numbers, but the amount actually billed sometimes differs — until now there was no
  way to say so from the phone. The panel is folded away behind a button (it is not shown
  every day) and exposes the ten money cells of the nippo: `E21`–`E24` (the amounts for
  ②–⑤) and `C29`–`C34` (basic fare, distance, collection, handling, ▲discount, total).
  - **The unit of override is one cell.** It means exactly what it means in the sheet: that
    cell now holds a typed number instead of a formula. Anything downstream (handling fee,
    discount, total) is recomputed from the overridden value, so the document stays
    internally consistent.
  - Empty means "leave it automatic"; the computed value shows as the placeholder, and it
    accounts for the other overrides you have already typed.
  - The ▲discount field takes a positive number and is stored negated — a numeric keypad
    has no minus sign on some phones.
  - Stored as `history[].fareOverride`, so it rides along in the backup JSON and reaches
    `01_nippo.py`, the nippo sheet and the invoice (hub format-spec §1, §3.1).
  - Overrides do not carry over to the next day; 業務完了 clears them.
- `fareParts()` takes an `override` argument, matching `fmt.fare_parts()` in the hub. The
  hub's `tests/test_fare_parity.py` checks the two against each other with overrides too.
- Overridden cells are painted orange in the generated PDF and the footer note gains a
  sentence explaining them, so a reader can tell a typed amount from a computed one. The
  same is true of the sheet the kit builds, so the two documents still match.

### Removed
- The "Excel転記用データをコピー" button on the report screen, and `copyToClipboard()`
  behind it. It copied the `NAGATASAN-EXPORT-1` KEY::VALUE text, which nothing reads: the
  kit takes the backup JSON (hub format-spec §7). It sat among the send buttons, one more
  thing to tap by mistake.

### Fixed
- The arrival address often named a place the driver was not at: a different town, and
  sometimes a different ward. The position was right; the address service was wrong.
  OpenStreetMap's Nominatim got all four of four landmarks with a known address wrong
  (a main station came back as the next 町, a castle as the next ward), and disagreed with the national data at
  23 of 39 random points. Addresses now come from the reverse geocoder of 国土地理院
  (GSI): `市区町村 + 町字`, for example `千代田区千代田`, or the municipality alone
  when GSI has no 町字. A point with no result (at sea) is `住所不明`. Nominatim, and the
  1.1 s spacing it needed, are gone.
  - GSI returns the municipality only as a code. `vendor/gsi-muni.json` maps the 1,919
    codes to names; `npm run build:muni` (`tools/build-gsi-muni.mjs`) rebuilds it from
    GSI's own `muni.js`. A code missing from the table gives `住所不明` rather than a bare
    町字, which `01_nippo.py` would otherwise copy into the B column as the city.
  - The request is aborted after 8 s. On a stalled connection it used to wait forever, and
    the screen stayed on "位置情報を取得中" until the app was killed. It now falls through to
    `住所取得エラー` like any other failure, keeping the coordinates.
  - The settings screen credits the source ("住所: 国土地理院"), as GSI asks.
- A run was dated by the day 業務完了 was pressed. A run started at 23:50 and closed at
  00:10 was recorded, reported to LINE and printed on the PDF as the next day. The date is
  now taken when 業務開始 is pressed and kept in `nippoData_pro_v3`, so it survives a
  reload; the history record, the LINE text, the PDF and the clipboard export all use it.
  A run started on an older version has no stored date and is still dated by today.
- Saving an edit of today's run left `lastAction` and the undo stack as they were before
  the edit. Deleting the last arrival kept 完了 enabled and 到着 disabled, so the next tap
  wrote a 完了 with no arrival. And the header's 戻る restored the pre-edit snapshot,
  silently throwing the edit away. Saving now recomputes `lastAction` from the last record
  (`start` when there is none) and empties the undo stack (hub state-machines SM-2).
- The header's 戻る deleted the last record on a single tap, with no question asked. It
  now asks first and names the record it is about to remove, for example
  "直前の記録（完了 10:23）を取り消しますか？" (hub state-machines SM-1).
- After saving an edit of today's run the undo stack is empty, so the header shows トップへ
  even though the run has records, and one OK wiped them all. When there are records the
  question now says how many will be deleted (`この運行の記録 N 件をすべて消して…`).
- Cancelling 業務開始 (トップへ) kept the day's results (①〜④) and the 金額を手直し
  amounts, so the next run was billed with them: an overridden total of 9,999 was still
  the total of the run started after the cancel. The cancel and 業務完了 now share one
  reset, which empties both and keeps only ⑤夏季手当 (hub state-machines SM-1).
- The position of the current arrival lived only in memory. If the app was reloaded
  between 到着 and 完了 (iOS often does this to a PWA in the background), 完了 offered no
  nearby destinations and did not learn the new one, without saying so. The position is
  now kept in `nippoData_pro_v3` as `arrivalPos`. The backup JSON is unchanged.
- The service worker deleted every cache but its own when it activated. Cache Storage is
  per origin, and hamanippo lives on the same `liner12345.github.io`, so each update of this
  app threw away hamanippo's offline copy (`nippou-v*`). It now deletes only its own old
  versions (`nagata-nippo-*`).
- 開始時刻 froze at the time the app had been opened, so a run started hours later was
  recorded — and billed — with the wrong start time. Two separate causes, both fixed:
  - `nippoData_pro_v3` is saved with `screen: 'start'` when 業務開始 is cancelled
    (`handleHeaderBack`), so a stale `startTime` stayed in storage and was restored on the
    next launch, surviving even a full reload. The saved time is now restored only when the
    run had actually started; on the start screen it means nothing.
  - The clock was read once, inside `onMounted`. A home-screen PWA can be resumed without a
    reload, and `onMounted` never runs a second time, so the field kept showing the time the
    page was first loaded. **The recorded time no longer depends on any resume event
    firing**: `startWork()` reads the clock at the moment the button is pressed.
  Refreshing the field itself (every 30 s, and when the page becomes visible again) is for
  the display only. A time typed by hand is never overwritten, and the field is left alone
  while it has focus — the iOS time picker jumps otherwise.
- The generated PDF drew an overridden amount of `0` as an empty cell. The kit's sheet holds
  a literal `0` there and shows `0`, so the app's PDF and the kit's PDF disagreed. A computed
  `0` is still blank (that is what the formula does); only a typed `0` is printed.

### Added
- The day's results (`①回収距離` `①回収箱数` `②配達数` `③追加配達` `④作業・待機` `⑤夏季手当`)
  on the report screen. These six numbers decide the collection and handling fees, and until
  now they existed nowhere in the app: they had to be typed into the nippo's yellow cells on
  the PC every single day. They are stored as `history[].daily` and ride along in the backup
  JSON, so `01_nippo.py` can fill `C19`–`C24` (format-spec §1, §4.1). The screen shows the
  resulting fare as you type, so a typo is visible before the day is closed.
- `nippo-pdf.js` and a "日報PDFを送る" button. It draws the nippo form
  (`fmt.build_nippo`, A1:H37) on a canvas and wraps it in a one-page PDF, then hands it to
  `navigator.share({files})`. The report used to have to travel to the PC and back before it
  could be sent as a PDF. No library and no embedded font: the page is an image, so the text
  in the PDF cannot be selected or searched — that is the price of not shipping a 数MB
  Japanese font with an offline-first app.
  - Lossless where `CompressionStream('deflate')` exists (Safari iOS 16.4+, Chrome 80+),
    JPEG everywhere else. The PDF container is assembled by hand.
  - The generated PDF is cached against the data it came from. iOS drops the user activation
    while the PDF is being built, so the second press shares straight from the cache.
  - `fareParts()` is a port of `fmt.fare_parts()`. **The fare now exists in three
    implementations** (the sheet formula, Python, JS); `tests/test_fare_parity.py` in the hub
    checks the last two against each other over a grid of boundary values.
- A "名前" field in the settings, written to `driverName` in the backup so `01_nippo.py` can
  fill the nippo's `F3`. That cell has always been left blank.
- `apple-touch-icon.png` (180x180) for better iOS compatibility.
- `favicon-32x32.png` and `favicon-16x16.png` for modern browser compatibility.
- `manifest.json` for PWA capabilities and reliable icon recognition on home screens.
- `FORMAT::NAGATASAN-EXPORT-1` as the first line of the clipboard export in `copyToClipboard()`,
  so the Excel import macro can verify the format version before parsing.
- GPS accuracy (`±Nm`) on the arrival confirmation screen, highlighted when it exceeds 50 m,
  so a bad fix is visible before it gets recorded.
- A "過去の日を記録" button on the history list. It creates an empty run dated the previous
  day and opens it straight in edit mode, so a day that was never recorded can be entered
  afterwards. Today's in-progress data (`nippoData_pro_v3`) is left untouched.
- An "案件を追加" button in edit mode. Cases could previously only be deleted, which made it
  impossible to build a run from nothing.
- A date field in edit mode, so a run stored under the wrong day can be moved. The stored
  `dateStr` keeps its `YYYY/MM/DD(曜)` shape, because `01_nippo.py` matches on the leading
  `YYYY/MM/DD` and silently skips history entries that do not.
- Confirmation prompts when saving a run dated in the future, or one that duplicates an
  existing date and starting odometer (the kit splits those into separate sheets).
- `sw.js`, a service worker that pre-caches the app shell and every dependency, so the app
  opens with no network at all. Delivery vans lose signal, and until now the app simply could
  not start without a connection.
- `vendor/`, holding pinned copies of Vue 3.5.42, Tailwind's generated CSS and Font Awesome
  6.0.0, all served same-origin.
- `package.json` and `tailwind.config.js` for regenerating `vendor/tailwind.css`. The generated
  file is committed, so serving the app still needs no build step.
- `.safe-top` in `style.css`. The header in `index.html` has carried that class from the start
  but it was never defined anywhere, so the header sat under the iPhone notch.
- Toll and parking fees, entered on the arrival screen and editable per case. They are summed
  per day into the nippo's `C25` / `C26` (format-spec §1, §4.1). The sheet has always had
  those cells; nothing ever filled them.
- A mileage check. An odometer reading below the previous one, or more than 200 km past it,
  now asks before it is recorded, and so does finishing a day over 300 km. The thresholds come
  from the real data (110 days, 311 legs): the largest plausible leg is 108 km with the next
  one at 512 km, and the largest plausible day is 98 km with the next at 1002 km.
- A warning badge on history entries that fail the same check, so records already stored can
  be found. Six of the 110 days in the current data are flagged.
- `vehicleNo` on each history entry, editable in the editor.
- A "LINEで送る" button on the report screen. It builds the day's report as readable text and
  hands it to `navigator.share()`, falling back to LINE's share URL and then to the clipboard.
  Until now the report had to be turned into a PDF before it could be sent.
- A summary on the dashboard: cases completed, distance so far, advanced fees, and where the
  last delivery was. The screen used to hold two buttons and nothing else.

### Fixed
- The "当日実績が未入力です" warning before building a PDF never fired, and the badge on the
  card always read 入力済. `daily.kaki` is seeded with the last-used value (or 500) at startup,
  so "is any field filled?" was always true. Completeness is now judged on the five fields that
  are entered day by day; the summer allowance carries over and is not counted.
  **Found by a Codex review of this branch.**
- The header logo sat too high. `.safe-top` set `padding-top: env(safe-area-inset-top)`, which
  **overrode the header's `p-4` top padding** — so on anything that reports no safe area (a
  phone without a notch, Safari's tabbed view) the top padding collapsed to 0 while the bottom
  stayed at 16px, and `items-center` centred the title 8px above the middle. With a notch it
  was off the other way. The header now carries `px-4` instead of `p-4`, so `.safe-top`'s
  padding only clears the notch and the content box is always 3.5rem. Measured: title centre
  28px, header centre 28px.
- The same bug at the bottom: `.scrollable-content`'s `padding-bottom: env(safe-area-inset-bottom)`
  wiped out `p-4`'s 16px on devices with no bottom inset, so the last element sat flush against
  the edge. Now `max(1rem, env(...))`.
- `.scrollable-content` had no `min-height: 0`. A flex item's minimum height defaults to its
  content, so the scroll area could refuse to shrink and overflow instead of scrolling.
- Left/right safe-area insets are respected, for landscape on a notched phone.
- The history section heading wrapped onto two lines, and so did both buttons next to it
  ("過去の日を記" / "録", "データ管" / "理"): "完了した日報（履歴）" plus two labelled buttons
  is 392px, two pixels wider than a 390px phone. Dropping "（履歴）" brings it to 332px.

### Changed
- **The vehicle-number history is a dropdown.** It used to be one row per entry; with the eight
  entries the app keeps, it ate about 400px and pushed the keypad and the start button off the
  first screen. The field and the history now read as one control: the number on the left, a
  divider, and a chevron on the right with a transparent `<select>` over it, so tapping there
  opens iOS's own picker. `select` was missing from the `-webkit-appearance: none` reset in
  `style.css`, so a plain one came out in iOS's native chrome and looked nothing like the
  fields beside it. Deleting an entry moved to the settings screen, where the eight numbers fit
  as chips and there is room for it.
- `tailwind.css` regenerated, and `package-lock.json` is now committed — the build had no
  lockfile, so `npm install` could resolve to different transitive versions each time.
- The text share now goes **straight to LINE** — `https://line.me/R/share?text=`, one tap to
  LINE's recipient picker — instead of calling `navigator.share()` first and putting the OS
  share sheet in the way. This is what hamanippo has always done
  (`apps/hamanippo/app.js:1376-1379`); nagatasan was the odd one out.
  **The PDF cannot take that route.** No LINE URL scheme, LIFF API or Messaging API message
  type accepts a local file, so `navigator.share({files})` — and therefore the share sheet —
  is the only way to hand LINE a PDF. The button says so, so the extra tap is not a surprise.
- The report screen's primary button is now the PDF one, with the text share below it.
- The copy buttons no longer share one toast flag; pressing one used to make both say
  "コピーしました！".
- `sw.js` `CACHE` to `v4`, and `nippo-pdf.js` added to `PRECACHE`.
- `index.html` to include appropriate `<link>` tags for the new icons and the manifest file.
- `getCurrentLocation()` now waits for the GPS accuracy to converge with `watchPosition()`
  instead of recording the first fix from `getCurrentPosition()`. Devices return a coarse
  Wi-Fi/cell fix first, which was being stored as-is and was the main source of wrong
  addresses. The most accurate sample is kept, and the watch stops as soon as the accuracy
  reaches 50 m or after 12 s. The number of reverse geocoding requests is unchanged:
  one per arrival.
- The formatted address no longer includes `road`, `house_number` or `building`. Japanese
  OSM data has almost no street numbers, so Nominatim snaps to the nearest feature and
  returned a prefectural road or a bridge name as part of the address.
- Reverse geocoding requests are spaced at least 1.1 s apart to stay within Nominatim's
  one-request-per-second policy, and the language is requested with the `accept-language`
  query parameter instead of a header.
- Overlapping address levels are collapsed by containment, not only by exact match.
  Nominatim can return a `neighbourhood` and a `quarter` where one is a prefix of the
  other, which used to be concatenated into a doubled place name.
- The history list is re-sorted by date, newest first, after a save, so a past day entered
  later lands in the right place.
- `saveAndReset()` builds the date through the shared `formatDateStr()` helper.
- Vue, Tailwind and Font Awesome now load from `vendor/` instead of unpkg,
  cdn.tailwindcss.com and cdnjs. `vue@3` resolved to whatever the newest 3.x happened to be,
  and cdn.tailwindcss.com is the play CDN that Tailwind documents as unfit for production.
- `manifest.json` declares `favicon.svg` with `sizes: "any"`, plus `id` and `scope`. No icon
  was 192px or larger, which Android requires before it will offer to install the app.
- Nearby destinations are offered without pressing anything: they are worked out on arrival,
  and the list opens by itself on the departure screen when there is something to show.
- The search radius follows the GPS accuracy (150-400 m) instead of a flat 150 m. With the
  old fixed radius a coarse fix left nothing in range, which is why the feature so rarely
  appeared to work.
- Candidates are ordered by distance, nearest first.
- The service worker serves the app itself network-first, falling back to the cache when
  offline, and keeps cache-first only for `vendor/`. An update now reaches the app without
  bumping the cache version.
- The dashboard sizes its two buttons by what comes next: the one to press is large, the one
  that cannot be used shrinks. They used to be equal and filled the screen between them.
- Text set at 10-11px is now 12px or more, and label grey moved from `gray-400` to `gray-500`.
  The old pairing was hard to read in daylight, which is where this app is used.
- Delete buttons are 44px (the floor in Apple's HIG) and sit further from the row they belong
  to. At 32px, right beside the tap target that opens a record, they invite a mis-tap.
- Keypad keys are 58px tall and edit fields are 16px, below which iOS zooms the page on focus.
- `tailwind.css` moved out of `vendor/` to the app root, and the cache version is now v3.
  `vendor/` is served cache-first, but this stylesheet is generated from `index.html`, so it
  belongs with the app: while it sat in `vendor/`, editing the markup left the old styles in
  place. This was found by hitting it — a disabled button kept its enabled colours.

### Fixed
- The `User-Agent` header is no longer set on the Nominatim request. It is a forbidden
  header name in `fetch()`, so the browser discarded it and the request went out unlabelled.
- A failed reverse geocoding lookup no longer throws the coordinates away. They are kept,
  so nearby-destination matching still works and only the address text needs fixing by hand.
- `saveEditMode()` located the record to write back by the **edited** `dateStr` and
  `startTime`. Changing either of them made the lookup fail and the edit was discarded
  without any message. The index is now captured when the record is opened.
- A corrupted `screen` value in localStorage left the app showing nothing at all: every
  `v-if` missed and the page rendered blank with no way out. The stored value is now checked
  against the five known screens.
- `nippoHistory_v2` and `nippoLocations` were restored without checking that they hold arrays.
- Restoring a backup accepted any JSON object at all; `history` must now be an array. The file
  input is cleared afterwards too, so the same file can be picked again after a failure.
- `copyToClipboard()` had no rejection path, so where the clipboard is unavailable the button
  did nothing whatsoever. It now reports the failure.
- Deleting the last history entry on a page left the list stranded on an empty page.
- `startWork()` accepted an empty odometer reading as 0 and started the day anyway.
- The dashboard read "案件1へ移動中" before work had even started.
- Deleting a saved destination rebuilt the candidate list by toggling the panel twice.
