# My Memory Master (mmm)

A three-dimensional concept-mapping desktop application. Like a mind map, but
you can drill *into* cards and *into* links to reveal deeper 2D planes — a
navigable 3D network of knowledge.

## What it does

- A white **canvas** shows one 2D **plane** at a time, operated by mouse **and**
  fully by keyboard.
- **Cards** are rounded rectangles with a bold heading, a divider, and a short
  text. Press `+` to add one; drag one card onto another to **link** them.
- Go deeper in two ways:
  - **Into a card** → a Markdown document plus attachments.
  - **Into a link** → a new 2D plane with further cards.
- Cards can be **tagged**; a tag shows as a small luggage-tag on the card, and
  clicking it opens a separate tag view where tags relate to one another.
- Everything is stored in a **local database** (one memory deck per database).
  Backups are zipped on demand ("Backup now") and automatically on exit; restore
  is available from the menu.
- The UI is **multilingual** (English by default, German available).

See [`requirements.md`](requirements.md) for the full business requirements and
[`documentation/`](documentation/) for architecture and design.

## Technology

- **Go + [Wails](https://wails.io/)** — native desktop shell with a WebView UI.
- **Pure-Go SQLite** (`modernc.org/sqlite`, no CGo) for simple cross-platform
  builds.
- Cross-platform: macOS and Windows (macOS first).

## Project structure

```
mymemorymaster/
├── readme.md                # this file
├── requirements.md          # business requirements (RFC-2119)
├── documentation/           # architecture, design, specs
└── src/
    ├── app/
    │   └── mmm/             # the My Memory Master application (executable: mmm)
    └── infra/              # infrastructure / deployment
```

## Build and run

The project is driven by **Taskfiles** (see [Task](https://taskfile.dev/)).
From the application directory:

```sh
cd src/app/mmm
task build     # build the mmm executable
task run       # build and run
task dev       # live-reload development
task check     # fmt + vet + test + frontend build
```

(Tasks are defined in `src/app/mmm/Taskfile.yaml`.)

## Status

Early scaffolding. Requirements are defined in `requirements.md`; implementation
follows.

## Glossary

Precise definitions of the terms used throughout mmm and this documentation.
Where a term has common synonyms, they are noted so nothing is ambiguous.

- **Canvas** — the white working surface that fills the window. It shows exactly
  one *plane* at a time. (Synonyms avoided: "board", "workspace".)
- **Plane** — one 2D layer of cards and links. The deck starts on the *root
  plane*. A plane can be reached by drilling into a card or a link.
- **Deck** — the entire memory network stored in one database. One database =
  one deck with exactly one *root node*.
- **Card** — the basic unit of knowledge: a rounded rectangle with a bold
  **heading**, a divider, and a short **body** text. (Synonyms avoided: "node",
  "box", "note".) A card also has an *icon*, an optional *date*, an optional
  *background color*, *tags*, and *external links*.
- **Root node / root card** — the first, undeletable card of the deck; the entry
  point of the whole network.
- **Main card (of a view)** — the root/entry card of the current plane; it shows
  the **Up** and **Down** navigation buttons.
- **Heading / title** — the bold top line of a card. "Title" and "heading" mean
  the same thing here.
- **Body / text / description** — the short text below the divider on a card,
  rendered as lightweight Markdown. "Body", "text" and "description" are used
  interchangeably.
- **Edit** — changing a card's title or body in place (double-click the body, or
  press Enter). Distinct from *drill down*.
- **Detail (dialog)** — the larger editor (key **E**) for a card's title, text,
  icon, background color, date, attachments, tags and external links.
- **Link / connection** — a visible connector between two cards on the same
  plane. "Link (between cards)" and "connection" mean the same. It attaches at
  an *anchor* (center/left/right/top/bottom), can have a *color* and a *width*
  (1/4/8), and may own a child plane.
- **External link / card link** — a URL, file, or folder reference attached to a
  card (opens in the OS). Not to be confused with a *connection* between cards.
- **Drill down / drill in** — going one level deeper: into a *card* opens that
  card's own new plane of cards; into a *link* opens the link's plane. Triggered
  by the Down button, double-clicking a card's title, or the key **D**.
- **Drill up / go up** — returning to the parent plane (Up button, **U**, Esc,
  or the Back button).
- **Breadcrumb** — the clickable path shown in the menu bar; each segment jumps
  back to that level.
- **Anchor** — one of the five connection points on a card (center, left, right,
  top, bottom) where a connection attaches.
- **Tag** — a labeled luggage-tag chip (max 16 characters, one of ten colors)
  attached to cards. Tags live in their own *tag view*.
- **Tag view** — a separate plane where tags are arranged and connected.
  Relations are **directed parent → child** (drag/connect from the broader tag
  to the narrower one).
- **Tag hierarchy** — because tag relations are directed, listing the cards of a
  parent tag also includes the cards of all tags below it (its descendants).
- **Multi-select** — selecting several cards at once via **Shift + drag** (a
  rubber-band rectangle); copy/cut/delete then act on the whole group.
- **Icon** — the small glyph at a card's top-right indicating its type: note,
  project, factory, calendar, idea, or **app** (shown as "m³").
- **Date** — a date (no time) set via the calendar icon; shown as a colored
  badge: green = future, blue = today, orange = past (overdue).
- **Backup** — a timestamped, zipped snapshot of the deck database (on demand
  with an optional title, and automatically on exit). The backup folder is
  configurable in *Settings*.
- **Restore** — replacing the live database with the contents of a backup.
- **Command bubble** — the 💬 menu entry: a text box that runs English base
  commands (e.g. `add card NAME`, `link NAME1 to NAME2`).
- **Deep link** — an external `mmm://card/<id>` URL that reopens the app and
  navigates to a specific card, however deeply nested.
- **Fit to window** — zoom/pan so all cards of the current plane are visible
  (menu ⤢ or key **W**). Distinct from *center on root* (key **0**).
- **Fullscreen** — the OS full-screen window mode (menu ⛶ or key **F**).
