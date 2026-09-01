# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
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

### Changed
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
