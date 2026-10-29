# My Memory Master (mmm) — Architecture

> Status: 2026-10-29 · Technical design and architecture decisions. Business
> requirements live in `../requirements.md`.

## 1. Overview

mmm is an offline-first desktop application. A **Go backend** owns all data and
business logic; a **WebView frontend** renders the canvas and handles
interaction. The two communicate through Wails' auto-generated bindings.

```
┌──────────────────────────────────────────────┐
│ Wails desktop shell (native window + menu)    │
│  ┌────────────────────┐   bindings   ┌──────┐ │
│  │ Frontend (WebView) │ ───────────▶ │  Go  │ │
│  │  canvas, cards,    │ ◀─────────── │ app  │ │
│  │  keyboard, i18n    │   events     └──┬───┘ │
│  └────────────────────┘                 │     │
└──────────────────────────────────────────┼─────┘
                                           ▼
                              local SQLite (one deck)
```

## 2. Architecture decisions (ADRs)

- **ADR-001: Go + Wails v2 (WebView UI).** Wails v2 is stable (v3 is still
  alpha as of mid-2026). It wraps Go and a web frontend into a single binary,
  with native menus and dialogs. *(decided)*
- **ADR-002: Pure-Go SQLite (`modernc.org/sqlite`, no CGo).** Keeps
  cross-platform builds (macOS + Windows) simple — no C toolchain required.
  *(decided)*
- **ADR-003: One memory deck per database.** Each SQLite file holds exactly one
  deck with one root node. Simpler model, matches the product concept.
  *(decided)*
- **ADR-004: Planes are first-class rows; depth is a parent reference.** A link
  may own a child plane (drill into link); a card owns a Markdown document and
  attachments (drill into card). This models the 3D network as a tree of 2D
  planes. *(decided)*
- **ADR-005: ZIP backup via `VACUUM INTO` + zip.** Timestamped zipped snapshots
  on demand and on exit; restore replaces the live DB atomically. *(decided)*
- **ADR-006: Frontend-driven i18n, English default.** Language resource files in
  the frontend (en, de), runtime switch, choice persisted. *(decided)*
- **ADR-007: Task-driven workflow.** All build/test/run/dev steps go through
  `Taskfile.yaml`. *(decided)*

## 3. Data model

One SQLite database = one deck.

- **plane** — a 2D layer. The root plane has no parent. A non-root plane is
  owned by the link it was drilled into (`owner_link_id`).
  - `id`, `kind` (`root` | `link_plane` | `tag_view`), `owner_link_id`,
    `view_state` (pan/zoom JSON), `created_at`, `updated_at`.
- **card** — a node on a plane.
  - `id`, `plane_id`, `heading`, `body`, `x`, `y`, `is_root`,
    `markdown` (the drill-in document), `created_at`, `updated_at`.
- **link** — a connection between two cards on the same plane. May own a child
  plane (drill-in).
  - `id`, `plane_id`, `from_card_id`, `to_card_id`, `child_plane_id`,
    `created_at`.
- **attachment** — a file attached to a card's document.
  - `id`, `card_id`, `filename`, `mime`, `data` (BLOB) or `path`, `created_at`.
- **tag** — a label. Shown as a luggage-tag on cards; related to other tags in
  the tag view.
  - `id`, `name`, `color`, `x`, `y` (position in tag view), `created_at`.
- **card_tag** — many-to-many between cards and tags. `card_id`, `tag_id`.
- **tag_relation** — edge between two tags in the tag view. `from_tag_id`,
  `to_tag_id`.
- **meta** — key/value app settings (language, schema version, last view).

Schema is created idempotently on start (`CREATE TABLE IF NOT EXISTS`) and
migrated with additive `PRAGMA table_info` column checks, as in the reference
project.

## 4. Backend packages (`src/app/mmm`)

```
src/app/mmm/
├── main.go            # Wails bootstrap, menu, lifecycle (backup on exit)
├── app.go             # App struct, bound methods (the frontend API)
├── Taskfile.yaml      # build/test/run/dev/check
├── internal/
│   ├── domain/        # Plane, Card, Link, Tag, Attachment types
│   ├── store/         # SQLite open, schema, migration, CRUD
│   └── backup/        # VACUUM INTO + zip, restore, timestamped snapshots
└── frontend/          # WebView UI (canvas, i18n)
    ├── src/           # canvas renderer, keyboard, cards, tags, menu, i18n
    └── wailsjs/       # generated bindings
```

Bound API (the surface the frontend calls), initial cut:

- Deck / planes: `GetRootPlane`, `GetPlane(id)`, `OpenLinkPlane(linkID)`,
  `SaveViewState(planeID, json)`.
- Cards: `CreateCard(planeID, x, y)`, `UpdateCard(card)`, `MoveCard(id, x, y)`,
  `DeleteCard(id)`, `GetCardDocument(id)`, `SaveCardDocument(id, markdown)`.
- Links: `CreateLink(fromID, toID)`, `DeleteLink(id)`.
- Tags: `ListTags`, `CreateTag(name)`, `AttachTag(cardID, tagID)`,
  `DetachTag(cardID, tagID)`, `GetTagView`, `LinkTags(a, b)`.
- Attachments: `AddAttachment(cardID, …)`, `ListAttachments(cardID)`,
  `OpenAttachment(id)`.
- Backup: `BackupNow`, `ListBackups`, `Restore(path)`.
- Settings: `GetLanguage`, `SetLanguage(lang)`.

## 5. Frontend

- Plain TypeScript + a 2D canvas (SVG or `<canvas>`) — no heavy framework
  needed for the first cut; keeps the binary and build simple.
- **Keyboard-first**: every primary action has a shortcut (add `+`, connect,
  drill in/out, move with arrows, edit, delete). Mouse mirrors these.
- **i18n**: `en.json` (default) and `de.json`; a small translator picks strings
  by key; language persisted via `SetLanguage`.

## 6. Runtime data location

- Database: `os.UserConfigDir()/MyMemoryMaster/mmm.db`
  (`~/Library/Application Support/MyMemoryMaster/mmm.db` on macOS).
- Backups: `…/MyMemoryMaster/backups/mmm-YYYYMMDD-HHMMSS.zip`.

## 7. Build & test

- `cd src/app/mmm && task check` → `go fmt` + `go vet` + `go test ./...` +
  frontend build.
- `task build` (macOS), `task build:windows`, `task run`, `task dev`.
- Executable name: **mmm**.
