# Changelog

All notable changes to My Memory Master (mmm) are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-29

First tagged release.

### Added
- **Markdown export** from the canvas right-click menu:
  - *Export this level* — writes the current plane (cards, metadata, bodies,
    card documents, external links, attachment names, and the connections
    between cards) to a single Markdown file.
  - *Export this level (recursive)* — additionally follows each card's and
    link's drill-in child plane, emitting them as nested sections. Only
    existing child planes are walked (no empty planes are created) and cycles
    are guarded against.
- **Export folder setting** in the Settings dialog, defaulting to `~/Downloads`
  on macOS and persisted in `config.json` (independent of the deck database).
- **Minimap** overlay (top-right of the canvas), toggled from a new menubar
  button between Fullscreen and Tag view. Shows all cards and the current
  viewport; click or drag on it to re-center the main view.

### Changed
- Removed the *Add card* button from the header menu. Cards are still created
  via the `+` keyboard shortcut, double-click on empty canvas, or the
  `add card` command.
- `task build`, `task build:windows`, `task run`, and `task install` now
  rebuild the frontend first, so they can no longer ship stale `frontend/dist`
  assets.

### Fixed
- Restore now applies a backup through the live database connection (ATTACH +
  transactional table copy) instead of swapping files under the open WAL
  connection, so a restore takes effect immediately and reliably.
