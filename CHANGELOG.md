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

### Fixed
- The `User-Agent` header is no longer set on the Nominatim request. It is a forbidden
  header name in `fetch()`, so the browser discarded it and the request went out unlabelled.
- A failed reverse geocoding lookup no longer throws the coordinates away. They are kept,
  so nearby-destination matching still works and only the address text needs fixing by hand.
- `saveEditMode()` located the record to write back by the **edited** `dateStr` and
  `startTime`. Changing either of them made the lookup fail and the edit was discarded
  without any message. The index is now captured when the record is opened.
