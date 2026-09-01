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

### Fixed
- The `User-Agent` header is no longer set on the Nominatim request. It is a forbidden
  header name in `fetch()`, so the browser discarded it and the request went out unlabelled.
- A failed reverse geocoding lookup no longer throws the coordinates away. They are kept,
  so nearby-destination matching still works and only the address text needs fixing by hand.
