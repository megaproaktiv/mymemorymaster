# My Memory Master (mmm) — Requirements

> Status: 2026-10-29 · Business requirements (RFC-2119 keywords: MUST, SHOULD,
> MAY). This document describes *what* the product does, not *how* it is built.
> Technical design lives in `documentation/`.

## 1. Vision

My Memory Master (**mmm**) is a three-dimensional concept-mapping tool. It is
similar to a mind map, but instead of a single flat diagram it lets the user
move *into* cards and *into* links to reveal deeper layers of 2D planes. The
result is a navigable 3D network of knowledge built out of stacked 2D planes.

The product is a cross-platform desktop application. It runs fully offline and
keeps all data in a local database.

## 2. Core concepts (glossary)

- **Canvas** — a white working surface that fills the window. A canvas shows
  exactly one 2D plane at a time.
- **Card** — the primary unit of knowledge. Drawn as a rounded rectangle with a
  **bold heading**, a horizontal divider, and a short unformatted text below.
- **Link** — a graphical connection between two cards on the same plane.
- **Plane** — one 2D layer of cards and links. The application starts on the
  root plane.
- **Depth / drill-in** — moving from a plane into a deeper layer. There are two
  distinct drill-in targets:
  1. Drilling **into a card** opens that card's Markdown document and its
     attachments.
  2. Drilling **into a link** opens a new 2D plane that holds further cards.
- **Tag** — a label attached to one or more cards. On a plane a tag is drawn as
  a small graphical luggage-tag on the card it belongs to. Clicking a tag opens
  the **tag view**, a separate plane where tags have relations to each other
  (the tags' own 3D network).
- **Memory deck** — the single network stored in one database. Each database
  holds exactly one deck with exactly one root node.
- **Root node** — the first card created in a new deck; the entry point to the
  whole network.

## 3. Epics and user stories

### E1 — Canvas and navigation [MUST]

- **US-1.1** The application MUST display a single white canvas as the working
  surface.
- **US-1.2** The user MUST be able to operate the canvas with the mouse
  (select, drag, pan, zoom).
- **US-1.3** The user MUST be able to operate the canvas **fully with the
  keyboard** (create, select, move, connect, drill in/out, navigate between
  cards) without needing the mouse.
- **US-1.4** The application MUST start by showing the root plane. Each database
  holds exactly one **memory deck**; a new deck MUST be created with a single
  root card.
- **US-1.5** The user MUST be able to pan and zoom the plane; the current
  view state SHOULD be remembered per plane.

### E2 — Cards [MUST]

- **US-2.1** A card MUST render as a rounded rectangle containing a bold
  heading, a divider line, and a short unformatted body text.
- **US-2.2** The user MUST be able to add a new card. Pressing `+` MUST create a
  new node on the current plane.
- **US-2.3** The user MUST be able to edit a card's heading and short text
  directly on the canvas.
- **US-2.4** The user MUST be able to move a card freely on the plane.
- **US-2.5** The user MUST be able to delete a card. Deleting a card MUST remove
  its links and warn about any deeper content that will be lost.

### E3 — Links between cards [MUST]

- **US-3.1** The user MUST be able to connect one card to another by dragging
  one card onto the other.
- **US-3.2** The user MUST be able to create and remove links using the keyboard
  as well.
- **US-3.3** Links MUST be drawn as visible connectors between the two cards and
  MUST follow the cards when they move.

### E4 — Depth / 3D drill-in [MUST]

- **US-4.1** Drilling into a **card** MUST open a Markdown document associated
  with that card. The user MUST be able to edit the Markdown.
- **US-4.2** A card's deeper view MUST allow attachments (files) to be added and
  later opened.
- **US-4.3** Drilling into a **link** MUST open a new, initially empty 2D plane
  that can hold further cards and links.
- **US-4.4** The user MUST be able to drill back out to the parent plane. The
  current depth / breadcrumb SHOULD be visible.

### E5 — Tags [SHOULD]

- **US-5.1** The user SHOULD be able to attach one or more tags to a card. Each
  attached tag MUST be drawn as a small graphical luggage-tag on the card.
- **US-5.2** Clicking a tag MUST open the **tag view** — a separate plane where
  tags have relations to one another (the tags' own network).
- **US-5.3** The user SHOULD be able to filter or highlight cards by tag.
- **US-5.4** A tag name MUST be at most 16 characters and MUST have one of ten
  predefined colors.
- **US-5.5** New tags MUST be created only in the tag view. When attaching a tag
  to a card, the user MUST choose from the existing tags; attaching MUST NOT
  create a new tag.
- **US-5.6** Tag relations MUST be directed, parent → child, and drawn with an
  arrow from the parent (broader) tag to the child (narrower) tag. Listing the
  cards of a tag MUST include the cards of all tags below it (its transitive
  descendants).

### E6 — Persistence [MUST]

- **US-6.1** All content (planes, cards, links, Markdown, attachments, tags,
  view state) MUST be stored in a local database.
- **US-6.2** Changes MUST be persisted automatically so no work is lost on exit.

### E7 — Backup and restore [MUST]

- **US-7.1** The menu MUST offer **Backup now** to produce a zipped snapshot of
  the database on demand.
- **US-7.2** The application MUST create a zipped backup automatically when the
  program exits.
- **US-7.3** The menu MUST offer **Restore** to recover the database from a
  previous backup.
- **US-7.4** Backups MUST be timestamped so multiple snapshots can coexist.

### E8 — Internationalization [MUST]

- **US-8.1** The user interface MUST be multilingual. English and German MUST be
  supported.
- **US-8.2** The application MUST start in **English** by default.
- **US-8.3** The user MUST be able to switch the language at runtime; the choice
  SHOULD be remembered.

### E9 — Cross-platform [MUST]

- **US-9.1** The application MUST be platform-independent and build for macOS
  and Windows (macOS first).
- **US-9.2** The build MUST not require a C toolchain (pure-Go dependencies,
  CGo-free SQLite) to keep cross-platform builds simple.

### E10 — Copy / cut / paste [MUST]

- **US-10.1** The user MUST be able to select a single card or, via Shift+drag
  (rubber-band), several cards at once on the current plane.
- **US-10.2** Copy/cut/paste and delete MUST operate only on cards of the
  **current plane**; the selection cannot span multiple planes.
- **US-10.3** Copying a card MUST copy its content (heading, body, icon,
  background color, date, size), its **tag associations**, its **external links**
  (URL/file/folder), and its **attachments**. When several cards are copied, the
  **connections between the selected cards** MUST also be copied.
- **US-10.4** A card's deeper content — its own child plane (drill-in sub-cards)
  — MUST NOT be copied; a pasted card starts with an empty sub-plane.
- **US-10.5** Cut MUST behave like copy followed by deleting the sources after a
  successful paste. Deleting (single or group) MUST be undoable (Cmd/Ctrl+Z).
- **US-10.6** Right-clicking a card that is part of a multi-selection MUST offer
  Copy, Cut and Delete acting on the whole selection.

### E11 — Command bubble [SHOULD]

- **US-11.1** The menu MUST offer a command bubble that accepts text commands,
  reachable both from the menu and via a keyboard shortcut (`/`). Commands are
  **English only**.
- **US-11.2** The following base commands MUST be supported:
  - `add card NAME` — create a new card with that title on the current plane.
  - `add tag TAGNAME` — attach the existing tag `TAGNAME` to the selected card.
  - `add tag TAGNAME CARDNAME` — attach the tag to the card named `CARDNAME`.
    `TAGNAME` MUST contain no spaces; `CARDNAME` MAY contain spaces and is
    matched only against cards on the current plane.
  - `link NAME1 to NAME2` — connect two cards on the current plane by title.
  - `edit TEXT` — append text to the selected card's description.
  - `add url URL` / `add file PATH` / `add folder PATH` — add an external link
    to the current card.
- **US-11.3** `add tag` MUST attach only an **existing** tag. If the tag does
  not exist, the command MUST return an error message (and MUST NOT create the
  tag) telling the user to create it in the tag view first.
- **US-11.4** A **Help** view MUST be available from the menu describing the
  base commands and the general functionality.

## 4. Non-functional requirements

- **NFR-1 Offline-first** — the application MUST work without any network
  connection. [MUST]
- **NFR-2 Local data ownership** — all data stays on the user's machine; no data
  is sent to third parties. [MUST]
- **NFR-3 Keyboard-first** — every primary action MUST be reachable from the
  keyboard. [MUST]
- **NFR-4 Responsiveness** — canvas interaction (pan, zoom, drag) SHOULD stay
  smooth for maps with hundreds of cards. [SHOULD]
- **NFR-5 Data integrity** — a restore MUST either fully succeed or leave the
  existing database untouched. [MUST]

## 5. Out of scope (for now)

- Real-time multi-user collaboration.
- Cloud sync / server component.
- Mobile / touch-first clients.

These MAY be revisited once the local application is complete.
