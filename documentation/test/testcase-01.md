# Testcase 01 — Full functional walkthrough

> Status: 2026-10-29 · Manual end-to-end test of My Memory Master (mmm). Run it
> top to bottom; each step lists the **action** and the **expected result**.
> Covers the canvas, cards, links between cards, depth (drill in/out), card
> detail (title, text, icon, background color, attachments, external links),
> tags and the tag view, backup/restore, undo, fullscreen, keyboard, and
> internationalization.

## 0. Preparation

| # | Action | Expected |
|---|--------|----------|
| 0.1 | Build and start: `cd src/app/mmm && task dev` (or `task run`). | A window titled **My Memory Master** opens with a white canvas. |
| 0.2 | Observe the canvas. | A single **root card** "My Memory Master" is centered. The status bar shows the keyboard hint. |
| 0.3 | Note the data location. | DB at `~/Library/Application Support/MyMemoryMaster/mmm.db`; backups in `…/backups/`. |

> Tip: to test from a clean state, quit the app and move the DB file aside.
> Do **not** delete the `backups/` folder if you want to keep snapshots.

## 1. Canvas & navigation

| # | Action | Expected |
|---|--------|----------|
| 1.1 | Drag empty canvas with the mouse. | The plane **pans**. |
| 1.2 | Scroll / pinch to zoom. | The plane **zooms** toward the cursor. |
| 1.3 | Press `0` (or menu **Center on root**). | View re-centers on the root card at zoom 1. |
| 1.4 | Resize the window. | The content stays centered; nothing jumps off-screen. |
| 1.5 | Press `F` (or menu **⛶**). | Window toggles **fullscreen**; press `F` again to leave. |
| 1.6 | On the root plane, look at the **Back** button. | It is **greyed out** (disabled). |

## 2. Cards

| # | Action | Expected |
|---|--------|----------|
| 2.1 | Press `+`. | A **New card** appears next to the selection and opens the inline editor. |
| 2.2 | Type a heading, press `Enter`, type a body, click away. | Card shows a **bold heading**, a divider, and the body text. |
| 2.3 | **Double-click the title** of a card. | Inline editor opens with the **title field focused**; change it and click away → the new title shows on the card. |
| 2.4 | **Double-click the text** of a card. | Inline editor opens with the **body field focused**; change it → the new text shows (Markdown rendered). |
| 2.5 | In the body type `# Heading`, `**bold**`, and a `- list item` on separate lines. | On the card these render as a heading, **bold**, and a bullet. |
| 2.6 | Drag a card. | It moves; its links follow. |
| 2.7 | Select a card and press arrow keys (Shift = larger step). | Card nudges; position persists. |
| 2.8 | Drag the **resize handle** (bottom-right ◢). | Card changes size (min ~120×70); size persists after restart. |
| 2.9 | **Double-click empty canvas**. | A new card is created at that point, editor open. |

## 3. Card type icon (incl. m³)

| # | Action | Expected |
|---|--------|----------|
| 3.1 | Open a card's detail (`E` or right-click → **Open detail**). | Dialog shows Title, Text, an **Icon** row and a **Background color** row. |
| 3.2 | Pick each icon: note, project, factory, calendar, idea, **app**. | The card's top-right icon updates. The **app** icon renders as **m³** (lowercase m with superscript 3), not a gear/W. |
| 3.3 | Save and reopen. | Chosen icon persists. |

## 4. Card background color (always light)

| # | Action | Expected |
|---|--------|----------|
| 4.1 | In the detail dialog, pick a **Background color** swatch; Save. | The card's background takes that **light** tint; black text stays clearly readable. |
| 4.2 | Right-click a card → **Background color** → pick a color. | Background updates immediately. |
| 4.3 | Try to force a dark color (if you edit the DB directly or via API). | It is **lightened automatically** — the stored color is always light. |
| 4.4 | Pick **White**. | Background returns to plain white. |

## 5. Links between cards (connections)

| # | Action | Expected |
|---|--------|----------|
| 5.1 | Hover a card. | Five **connection circles** appear: center, left, right, top, bottom. |
| 5.2 | Drag from one card's circle to another card's circle. | A **directed connection** is drawn between those anchors. |
| 5.3 | Drag from a circle onto a second card's body (not a circle). | Connects to that card's center. |
| 5.4 | Drag from a circle into **empty space**. | A **new card is created** there and linked automatically. |
| 5.5 | Select a card, press `L`, then click another card. | Link created via keyboard. |
| 5.6 | **Click a connection** to select it, then press `Del`. | The connection is deleted. |
| 5.7 | **Right-click a connection**. | Menu offers **Delete**, **Width 1 / 4 / 8**, and named colors (Red, Orange, …). |
| 5.8 | Set width 8 and a color. | The line is visibly **thicker and colored**. |

## 6. Depth — drill in / out

| # | Action | Expected |
|---|--------|----------|
| 6.1 | Look at the **main card** of the view. | It shows a **Down** icon (and, below the root, an **Up** icon) in its title bar. |
| 6.2 | Click the **Down** icon (or select a card and press `D`). | You descend into that card's **own new plane**; the window title shows the card name; a root card is present. |
| 6.3 | Add cards on the sub-plane (`+`). | New cards appear on the deeper plane. |
| 6.4 | Press `U` (or the main card's **Up** icon, or **Back**). | You return to the parent plane. |
| 6.5 | Create a connection, drill into it (select link, `D`). | A **new plane for the link** opens. |
| 6.6 | Drill down, add/link cards, go back up, then back down. | All cards **and links persist** (nothing disappears). |

## 7. Attachments

| # | Action | Expected |
|---|--------|----------|
| 7.1 | In detail, **Add attachment**, pick an image. | It appears in the attachment list (name shortened, hover shows full name). |
| 7.2 | Click the image attachment. | An **inline image viewer** opens. |
| 7.3 | Add a PDF attachment and click it. | It opens in the **OS default PDF viewer**. |

## 8. External links (URL / file / folder)

| # | Action | Expected |
|---|--------|----------|
| 8.1 | Right-click a card → **Add URL link**; enter `https://example.com`, then a short label. | Link stored; shown with the **≤16-char label**. |
| 8.2 | Right-click → **Add file link**; pick a file; enter a label. | File link added. |
| 8.3 | Right-click → **Add folder link**; pick a directory. | Folder link added. |
| 8.4 | Look at the card. | Links show as short labels (`🔗`/`📁`, ≤16 chars). Hover shows the **full target**. |
| 8.5 | **Right-click the card** again. | The menu **lists the existing links**; clicking one opens it. |
| 8.6 | Click a URL link. | Opens in the browser. Click a file/folder link → opens in the OS. |
| 8.7 | Press `A` on a selected card. | A small menu offers **URL / file / folder** link. |

## 9. Tags & tag view

| # | Action | Expected |
|---|--------|----------|
| 9.1 | Right-click a card → **Add tag**; enter a name (try >16 chars). | Tag attached; name is **clamped to 16 characters**. |
| 9.2 | Look at the card. | The tag shows as a small **luggage-tag** chip in its color. |
| 9.3 | Right-click → **Remove tag** → choose the tag. | Tag removed from the card. |
| 9.4 | Menu bar → **Tag view** (or click a tag chip). | A separate **tag plane** opens with a grid background. |
| 9.5 | In the tag view, **＋ Add tag**. | A new tag chip appears. |
| 9.6 | Drag a tag chip. | It moves; position persists. |
| 9.7 | **Shift-drag** from one tag onto another. | The two tags are **connected** with a line. |
| 9.8 | Click a tag-tag connection. | Prompt to remove it. |
| 9.9 | Right-click a tag chip. | Menu offers **Delete** and 10 named **colors**. |

## 10. Copy / cut / paste

| # | Action | Expected |
|---|--------|----------|
| 10.1 | Select a card, `⌘/Ctrl+C`. | Status: card copied. |
| 10.2 | `⌘/Ctrl+V` (or right-click canvas → **Paste card**). | A **copy** appears at the cursor. |
| 10.3 | Select a card, `⌘/Ctrl+X`, then paste. | The card is **moved** (cut) to the new spot. |
| 10.4 | Right-click canvas → **Insert card here**. | A new card is created at that point. |

## 11. Delete & Undo

| # | Action | Expected |
|---|--------|----------|
| 11.1 | Select a non-root card, press `Del`. | A confirm dialog appears; confirm → card **and its links** are removed. |
| 11.2 | Press `⌘/Ctrl+Z`. | The card is **restored** with its text, icon, background, tags, links and connections. |
| 11.3 | Try to delete the **root card**. | Refused with a message. |

## 12. Backup & restore

| # | Action | Expected |
|---|--------|----------|
| 12.1 | Menu → **Backup now**; enter a title (≤32 chars). | A timestamped **.zip** is created in `…/backups/`; status shows the title + filename. |
| 12.2 | Menu → **Restore**. | A list of backups shows **title + filename + size**. |
| 12.3 | Quit the app. | An automatic **backup-on-exit** zip is written. |
| 12.4 | (Optional) Restore an older backup. | DB is replaced; a restart shows the restored content. The original is kept as `mmm.db.pre-restore`. |

## 13. Internationalization

| # | Action | Expected |
|---|--------|----------|
| 13.1 | Start the app the first time. | UI is in **English** by default. |
| 13.2 | Switch the language selector to **DE**. | Menus, hints and dialogs switch to **German** at runtime. |
| 13.3 | Restart. | The chosen language is **remembered**. |

## 14. Persistence sanity

| # | Action | Expected |
|---|--------|----------|
| 14.1 | Make several changes (cards, links, colors, tags). | No explicit save needed. |
| 14.2 | Quit and restart. | **All changes are present** (local SQLite, one deck per database). |

---

### Pass criteria

All rows produce their **Expected** result. Note any deviation with the step
number. Known-harmless console noise on macOS: `NSKeyBindingManager: Bad key
binding atom …` (system messages, not from mmm).
