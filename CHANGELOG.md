# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- `apple-touch-icon.png` (180x180) for better iOS compatibility.
- `favicon-32x32.png` and `favicon-16x16.png` for modern browser compatibility.
- `manifest.json` for PWA capabilities and reliable icon recognition on home screens.
- `FORMAT::NAGATASAN-EXPORT-1` as the first line of the clipboard export in `copyToClipboard()`,
  so the Excel import macro can verify the format version before parsing.

### Changed
- `index.html` to include appropriate `<link>` tags for the new icons and the manifest file.
