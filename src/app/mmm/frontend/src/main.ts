// My Memory Master (mmm) — frontend controller.
// White canvas with cards and links; mouse and full keyboard operation;
// drill into cards (Markdown + attachments) and into links (new plane);
// luggage-tags open the separate tag view; backup/restore from the menu.
import "./style.css";
import { Canvas, ViewState, CARD_W, CARD_H, Anchor, anchorPoint, cardW, cardH } from "./canvas";
import { iconHtml, ICON_NAMES } from "./icons";
import { initI18n, t, lang, setLang, Lang } from "./i18n";
import { domain } from "../wailsjs/go/models";
import * as App from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";

type PlaneContent = domain.PlaneContent;

// A frame in the drill-in navigation stack. We store the plane id and a label
// only; content is always fetched fresh from the backend so nothing is stale.
interface Frame {
  planeId: number;
  label: string;
}

class Controller {
  private canvas!: Canvas;
  private host!: HTMLElement;
  private statusEl!: HTMLElement;
  private breadcrumbEl!: HTMLElement;

  // Navigation stack of planes (breadcrumb for drill in/out).
  private stack: Frame[] = [];
  private cards: domain.Card[] = [];
  private links: domain.Link[] = [];

  private selectedCardId: number | null = null;
  private selectedLinkId: number | null = null;

  // Interaction state.
  private linkMode = false; // keyboard "L": pick source then target card
  private linkSourceId: number | null = null;
  private dragState:
    | {
        cardId: number;
        origX: number;
        origY: number;
        startX: number;
        startY: number;
        moved: boolean;
      }
    | null = null;
  private panState: { x: number; y: number } | null = null;
  private windowEventsBound = false;

  // Anchor-drag connection state.
  private connectState:
    | { fromCardId: number; fromAnchor: Anchor }
    | null = null;
  // Card resize state.
  private resizeState:
    | { cardId: number; startX: number; startY: number; origW: number; origH: number }
    | null = null;
  // Rubber-band multi-select state (Shift + drag on empty canvas).
  private bandState:
    | { startWX: number; startWY: number; additive: boolean }
    | null = null;
  // Set of selected card ids for multi-select (includes selectedCardId).
  private selectedCardIds = new Set<number>();
  // Clipboard: one or more cards. "cut" removes the sources after paste.
  private clipboard: { cardIds: number[]; mode: "copy" | "cut" } | null = null;
  // Undo stack (supports single and group card deletion).
  private undoStack: (
    | { kind: "deleteCard"; snapshot: any }
    | { kind: "deleteCards"; snapshot: any }
  )[] = [];
  // Last known mouse position in client coords (for paste-at-cursor).
  private lastMouse = { x: 0, y: 0 };
  // Command bubble history (most recent last).
  private commandHistory: string[] = [];

  // Minimap overlay (upper-right of the canvas) — null when hidden.
  private minimap: {
    root: HTMLElement;
    svg: SVGSVGElement;
    cards: SVGGElement;
    viewport: SVGRectElement;
  } | null = null;
  private minimapOn = false;

  async start() {
    await initI18n();
    this.buildChrome();
    this.installKeyboard();
    this.installCanvasEvents();
    const root = await App.GetRootPlane();
    await this.pushFrame(root.plane.id, t("app.title"));
    this.setStatus(t("status.ready"));
    this.installDeepLinks();
  }

  // Deep links: handle a link that started the app (pending) and any that
  // arrive while running (runtime event mmm://card/<id>).
  private async installDeepLinks() {
    EventsOn("deeplink:card", (id: number) => {
      if (id) this.navigateToCard(id);
    });
    try {
      const pending = await App.ConsumePendingDeepLink();
      if (pending) this.navigateToCard(pending);
    } catch {
      /* ignore */
    }
  }

  // ---- Chrome (menu + status) ---------------------------------------------

  private buildChrome() {
    const app = document.getElementById("app")!;
    app.replaceChildren();
    // The old DOM (including any minimap) is gone; drop the stale reference so
    // the minimap is rebuilt below if it was visible.
    this.minimap = null;

    const menubar = document.createElement("div");
    menubar.className = "menubar";
    menubar.innerHTML = `
      <button data-act="center">⊙ <span>${t("menu.center")}</span></button>
      <button data-act="back">← <span>${t("menu.back")}</span></button>
      <span class="breadcrumb"></span>
      <span class="spacer"></span>
      <div class="searchbox">
        <input class="search-input" type="text" placeholder="${t("search.placeholder")}" />
        <ul class="search-results"></ul>
      </div>
      <span class="spacer"></span>
      <button data-act="fit" title="${t("menu.fit")} (W)">⤢</button>
      <button data-act="fullscreen" title="${t("menu.fullscreen")}">⛶</button>
      <button data-act="minimap" title="${t("menu.minimap")}">🗺 <span>${t("menu.minimap")}</span></button>
      <button data-act="tags">${t("menu.tags")}</button>
      <button data-act="backup">${t("menu.backup")}</button>
      <button data-act="restore">${t("menu.restore")}</button>
      <button data-act="settings" title="${t("menu.settings")}">⚙</button>
      <button data-act="command" title="${t("menu.command")} (/)">💬</button>
      <button data-act="help" title="${t("menu.help")}">?</button>
      <select data-act="lang" title="${t("menu.language")}">
        <option value="en">EN</option>
        <option value="de">DE</option>
      </select>`;
    app.appendChild(menubar);
    this.breadcrumbEl = menubar.querySelector(".breadcrumb")!;
    (menubar.querySelector('[data-act="lang"]') as HTMLSelectElement).value = lang();

    menubar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("button");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "center") this.centerOnRoot();
      else if (act === "fit") this.fitToWindow();
      else if (act === "fullscreen") App.ToggleFullscreen();
      else if (act === "minimap") this.toggleMinimap();
      else if (act === "back") this.drillOut();
      else if (act === "tags") this.openTagView();
      else if (act === "backup") this.backupNow();
      else if (act === "restore") this.openRestoreDialog();
      else if (act === "settings") this.openSettings();
      else if (act === "command") this.openCommandBar();
      else if (act === "help") this.openHelp();
    });
    menubar.querySelector('[data-act="lang"]')!.addEventListener("change", async (e) => {
      await setLang((e.target as HTMLSelectElement).value as Lang);
      this.buildChrome();
      this.installCanvasEvents();
      this.renderBreadcrumb();
      this.rerender();
    });

    this.installSearch(menubar);

    const wrap = document.createElement("div");
    wrap.className = "canvas-wrap";
    wrap.tabIndex = 0; // focusable for keyboard
    app.appendChild(wrap);
    this.host = wrap;
    this.canvas = new Canvas(wrap, {
      onCardPointerDown: (e, c) => this.onCardPointerDown(e, c),
      onTitleDblClick: (c) => {
        this.selectedCardId = c.id;
        this.selectedLinkId = null;
        this.drillIntoCard(c);
      },
      onBodyDblClick: (c) => {
        this.selectedCardId = c.id;
        this.selectedLinkId = null;
        this.editCard(c, "body");
      },
      onDrillIconClick: (c) => this.drillIntoCard(c),
      onCardUpClick: () => this.drillOut(),
      onDateIconClick: (e, c) => this.openDatePicker(e, c),
      onCardContextMenu: (e, c) => this.openCardContextMenu(e, c),
      onLinkClick: (l) => this.onLinkClick(l),
      onLinkContextMenu: (e, l) => this.openLinkContextMenu(e, l),
      onCardLinkClick: async (l) => {
        try {
          await App.OpenCardLink(l.id);
        } catch (err) {
          this.setStatus(String(err));
        }
      },
      onTagClick: (tag) => this.openTagView(tag),
      onAnchorPointerDown: (e, c, anchor) => this.onAnchorPointerDown(e, c, anchor),
      onResizePointerDown: (e, c) => this.onResizePointerDown(e, c),
    });

    const status = document.createElement("div");
    status.className = "statusbar";
    status.innerHTML = `<span class="msg"></span><span class="hint">${t(
      "hint.keyboard",
    )}</span>`;
    app.appendChild(status);
    this.statusEl = status.querySelector(".msg")!;

    this.host.focus();

    // Restore minimap visibility across chrome rebuilds (language change).
    const mmBtn = this.host.ownerDocument!.querySelector(
      '[data-act="minimap"]',
    ) as HTMLButtonElement | null;
    if (mmBtn) mmBtn.classList.toggle("active", this.minimapOn);
    if (this.minimapOn) {
      this.buildMinimap();
      this.updateMinimap();
    }
  }

  private setStatus(msg: string) {
    if (this.statusEl) this.statusEl.textContent = msg;
  }

  private renderBreadcrumb() {
    this.breadcrumbEl.replaceChildren();
    this.stack.forEach((f, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "crumb-sep";
        sep.textContent = "  ›  ";
        this.breadcrumbEl.appendChild(sep);
      }
      const seg = document.createElement("a");
      seg.className = "crumb";
      seg.href = "#";
      seg.textContent = f.label || t("app.title");
      if (i === this.stack.length - 1) seg.classList.add("current");
      seg.addEventListener("click", (e) => {
        e.preventDefault();
        this.jumpToLevel(i);
      });
      this.breadcrumbEl.appendChild(seg);
    });
  }

  // Jump back to a breadcrumb level (truncates the stack to that index).
  private async jumpToLevel(index: number) {
    if (index < 0 || index >= this.stack.length - 1) return; // already there / invalid
    await this.saveViewState();
    this.stack.length = index + 1;
    await this.loadFrame();
    this.setStatus(t("status.ready"));
  }

  // ---- Title search bar ----------------------------------------------------

  // Install the search box: type to see matching card titles across the deck;
  // Down/Up to move the highlight, Tab to complete, Enter to jump to the card.
  private installSearch(menubar: HTMLElement) {
    const input = menubar.querySelector(".search-input") as HTMLInputElement;
    const list = menubar.querySelector(".search-results") as HTMLElement;
    if (!input || !list) return;

    let hits: { id: number; heading: string; planeId: number }[] = [];
    let active = -1;
    let seq = 0;

    const closeList = () => {
      list.replaceChildren();
      list.style.display = "none";
      hits = [];
      active = -1;
    };

    const renderList = () => {
      list.replaceChildren();
      if (hits.length === 0) {
        list.style.display = "none";
        return;
      }
      hits.forEach((h, i) => {
        const li = document.createElement("li");
        li.textContent = h.heading || t("card.newHeading");
        if (i === active) li.classList.add("active");
        li.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          this.gotoSearchHit(h.id);
          input.value = "";
          closeList();
        });
        list.appendChild(li);
      });
      list.style.display = "block";
    };

    const runSearch = async () => {
      const q = input.value.trim();
      if (!q) {
        closeList();
        return;
      }
      const mySeq = ++seq;
      try {
        const res = (await App.SearchCards(q, 12)) ?? [];
        if (mySeq !== seq) return; // a newer query superseded this one
        hits = res;
        active = hits.length > 0 ? 0 : -1;
        renderList();
      } catch {
        closeList();
      }
    };

    let debounce: number | undefined;
    input.addEventListener("input", () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(runSearch, 120);
    });

    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // don't trigger canvas shortcuts while typing
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (hits.length) {
          active = (active + 1) % hits.length;
          renderList();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (hits.length) {
          active = (active - 1 + hits.length) % hits.length;
          renderList();
        }
      } else if (e.key === "Tab") {
        // Complete the input to the active suggestion (do not navigate yet).
        if (active >= 0 && hits[active]) {
          e.preventDefault();
          input.value = hits[active].heading;
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (active >= 0 && hits[active]) {
          this.gotoSearchHit(hits[active].id);
          input.value = "";
          closeList();
          this.host.focus();
        }
      } else if (e.key === "Escape") {
        input.value = "";
        closeList();
        this.host.focus();
      }
    });

    input.addEventListener("blur", () => {
      // Delay so a pointerdown on a result can run first.
      window.setTimeout(closeList, 150);
    });
  }

  // Navigate to a card chosen from the search results (deep-link across planes).
  private gotoSearchHit(cardId: number) {
    this.navigateToCard(cardId);
  }

  // ---- Frames / navigation -------------------------------------------------

  private get frame(): Frame {
    return this.stack[this.stack.length - 1];
  }
  private get planeId(): number {
    return this.frame.planeId;
  }

  // Push a new plane onto the stack and load it fresh.
  private async pushFrame(planeId: number, label: string) {
    this.stack.push({ planeId, label });
    await this.loadFrame();
  }

  // Load the current frame's plane fresh from the backend.
  private async loadFrame() {
    let content: PlaneContent;
    try {
      content = await App.GetPlane(this.frame.planeId);
    } catch (err) {
      this.setStatus(String(err));
      return;
    }
    this.cards = content.cards ?? [];
    this.links = content.links ?? [];
    this.selectedCardId = this.cards.find((c) => c.isRoot)?.id ?? this.cards[0]?.id ?? null;
    this.selectedLinkId = null;
    this.renderBreadcrumb();
    this.updateBackButton();
    // Show the current plane's label in the native window title bar.
    App.SetWindowTitle(
      this.stack.length <= 1 ? t("app.title") : `${t("app.title")} — ${this.frame.label}`,
    );

    const stored = this.parseView(content.plane.viewState);
    if (stored) {
      this.canvas.setView(stored);
      this.rerender();
    } else {
      // No stored view: render first, then center on root once the canvas has
      // a real size (after layout).
      this.rerender();
      requestAnimationFrame(() => {
        this.centerOnRoot();
        this.saveViewState();
      });
    }
  }

  // Returns the stored view, or null if none/invalid (so the caller can center).
  private parseView(json: string): ViewState | null {
    try {
      const v = JSON.parse(json);
      if (v && typeof v.zoom === "number" && typeof v.panX === "number") return v;
    } catch {
      /* ignore */
    }
    return null;
  }

  // Center the view on the root card (or the first card, or world origin).
  private centerOnRoot() {
    const target =
      this.cards.find((c) => c.isRoot) ?? this.cards[0] ?? null;
    const wx = target ? target.x + CARD_W / 2 : CARD_W / 2;
    const wy = target ? target.y + CARD_H / 2 : CARD_H / 2;
    this.canvas.centerOn(wx, wy, 1);
    this.rerender();
    this.setStatus(t("status.ready"));
  }

  private rerender() {
    // The "main card" of the view is the root card (root plane) or the first
    // card (sub-plane). It gets Up/Down navigation buttons.
    const main = this.cards.find((c) => c.isRoot) ?? this.cards[0] ?? null;
    const canGoUp = this.stack.length > 1;
    this.canvas.render(
      this.cards,
      this.links,
      this.selectedCardId,
      this.selectedLinkId,
      main ? main.id : null,
      canGoUp,
    );
    this.updateMinimap();
  }

  private async reloadPlane() {
    const content = await App.GetPlane(this.planeId);
    this.cards = content.cards ?? [];
    this.links = content.links ?? [];
    this.rerender();
  }

  private async drillOut() {
    if (this.stack.length <= 1) return;
    await this.saveViewState();
    this.stack.pop();
    await this.loadFrame();
    this.setStatus(t("status.ready"));
  }

  // Grey out the Back button on the root plane.
  private updateBackButton() {
    const btn = document.querySelector('[data-act="back"]') as HTMLButtonElement | null;
    if (btn) btn.disabled = this.stack.length <= 1;
  }

  // Deep-link navigation: jump to any card by replaying the drill-in path from
  // the root (used by the tag view's "cards with this tag" list).
  private async navigateToCard(cardId: number) {
    try {
      const path = await App.BuildCardPath(cardId);
      // Reset to the root frame.
      const root = await App.GetRootPlane();
      this.stack = [{ planeId: root.plane.id, label: t("app.title") }];
      await this.loadFrame();
      // Replay each drill-in step.
      for (const step of path.steps ?? []) {
        let content;
        let label = "";
        if (step.kind === "card") {
          content = await App.OpenCardPlane(step.id);
          const c = this.cards.find((x) => x.id === step.id);
          label = c?.heading ?? t("card.newHeading");
        } else {
          content = await App.OpenLinkPlane(step.id);
          label = "↔";
        }
        this.stack.push({ planeId: content.plane.id, label });
        await this.loadFrame();
      }
      // Select and center the target card.
      this.selectedCardId = path.targetCardId;
      const target = this.cards.find((c) => c.id === path.targetCardId);
      if (target) this.canvas.centerOn(target.x + CARD_W / 2, target.y + CARD_H / 2);
      this.rerender();
      this.setStatus(t("status.ready"));
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  private async saveViewState() {
    try {
      await App.SaveViewState(this.planeId, JSON.stringify(this.canvas.getView()));
    } catch {
      /* ignore */
    }
  }

  // ---- Cards ---------------------------------------------------------------

  private async addCard() {
    // Place near the selected card, else at the view centre.
    let x = 40;
    let y = 40;
    const sel = this.selectedCard();
    if (sel) {
      x = sel.x + CARD_W + 40;
      y = sel.y;
    } else {
      const rect = this.host.getBoundingClientRect();
      const w = this.canvas.toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      x = w.x - CARD_W / 2;
      y = w.y - CARD_H / 2;
    }
    await this.addCardAt(x, y);
  }

  // Create a card at world coordinates (x, y) and start editing it.
  private async addCardAt(x: number, y: number) {
    const card = await App.CreateCard(this.planeId, x, y);
    this.cards.push(card);
    this.selectedCardId = card.id;
    this.selectedLinkId = null;
    this.rerender();
    this.editCard(card);
  }

  private selectedCard(): domain.Card | undefined {
    return this.cards.find((c) => c.id === this.selectedCardId);
  }

  // Screen-space point near a card (for popups anchored to the card).
  private cardScreenPoint(c: domain.Card): { x: number; y: number } {
    const view = this.canvas.getView();
    const rect = this.canvas.svg.getBoundingClientRect();
    return {
      x: rect.left + c.x * view.zoom + view.panX + 20,
      y: rect.top + c.y * view.zoom + view.panY + 20,
    };
  }

  private async deleteSelectedCard() {
    const ids = this.effectiveSelection();
    // Multi-select delete.
    if (ids.length > 1) {
      if (!(await this.confirmDialog(`${t("confirm.deleteCards")} (${ids.length})`))) return;
      try {
        const snap = await App.DeleteCardsWithUndo(ids);
        this.undoStack.push({ kind: "deleteCards", snapshot: snap });
        if (this.undoStack.length > 50) this.undoStack.shift();
      } catch (err) {
        this.setStatus(String(err));
        return;
      }
      this.selectedCardIds.clear();
      this.selectedCardId = null;
      this.canvas.setSelectedSet(this.selectedCardIds);
      await this.reloadPlane();
      this.rerender();
      this.setStatus(t("status.deletedUndo"));
      return;
    }

    const c = this.selectedCard();
    if (!c) return;
    if (c.isRoot) {
      this.setStatus(t("status.rootCardNoDelete"));
      return;
    }
    if (!(await this.confirmDialog(t("confirm.deleteCard")))) return;
    try {
      const snap = await App.DeleteCardWithUndo(c.id);
      this.undoStack.push({ kind: "deleteCard", snapshot: snap });
      if (this.undoStack.length > 50) this.undoStack.shift();
    } catch (err) {
      this.setStatus(String(err));
      return;
    }
    await this.reloadPlane();
    this.selectedCardId = this.cards[0]?.id ?? null;
    this.rerender();
    this.setStatus(t("status.deletedUndo"));
  }

  // Undo the last undoable action (Cmd/Ctrl+Z).
  private async undoLast() {
    const action = this.undoStack.pop();
    if (!action) {
      this.setStatus(t("status.nothingUndo"));
      return;
    }
    try {
      if (action.kind === "deleteCard") {
        await App.RestoreCard(action.snapshot);
        await this.reloadPlane();
        this.selectedCardId = action.snapshot.card.id;
      } else if (action.kind === "deleteCards") {
        await App.RestoreCards(action.snapshot);
        await this.reloadPlane();
        this.selectedCardIds = new Set(
          (action.snapshot.cards ?? []).map((cs: any) => cs.card.id),
        );
        this.canvas.setSelectedSet(this.selectedCardIds);
      }
      this.rerender();
      this.setStatus(t("status.undone"));
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  // Inline editor for heading + body. focus selects which field to focus.
  private editCard(card: domain.Card, focus: "title" | "body" = "title") {
    const existing = this.host.querySelector(".card-editor");
    if (existing) existing.remove();

    const view = this.canvas.getView();
    const screenX = card.x * view.zoom + view.panX;
    const screenY = card.y * view.zoom + view.panY;

    const editor = document.createElement("div");
    editor.className = "card-editor";
    editor.style.left = `${screenX}px`;
    editor.style.top = `${screenY}px`;
    editor.style.width = `${cardW(card) * view.zoom}px`;
    editor.innerHTML = `
      <input class="h" value="" />
      <hr />
      <textarea class="b"></textarea>
      <div class="icon-row"></div>`;
    const h = editor.querySelector(".h") as HTMLInputElement;
    const b = editor.querySelector(".b") as HTMLTextAreaElement;
    h.value = card.heading;
    b.value = card.body;

    // Icon picker row.
    const iconRow = editor.querySelector(".icon-row") as HTMLElement;
    let chosenIcon: string = card.icon || "note";
    ICON_NAMES.forEach((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon-btn";
      btn.title = name;
      btn.innerHTML = iconHtml(name, 16);
      if (name === chosenIcon) btn.classList.add("active");
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        chosenIcon = name;
        iconRow.querySelectorAll(".icon-btn").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
      });
      iconRow.appendChild(btn);
    });

    this.host.appendChild(editor);
    if (focus === "body") {
      b.focus();
    } else {
      h.focus();
      h.select();
    }

    const commit = async () => {
      if (!editor.isConnected) return;
      const heading = h.value.trim() || t("card.newHeading");
      const body = b.value;
      editor.remove();
      try {
        await App.UpdateCard(card.id, heading, body);
        if (chosenIcon && chosenIcon !== (card.icon || "note")) {
          await App.SetCardIcon(card.id, chosenIcon);
        }
      } catch (err) {
        this.setStatus(String(err));
      }
      // Update the live card object in this.cards so the change renders.
      const live = this.cards.find((c) => c.id === card.id);
      if (live) {
        live.heading = heading;
        live.body = body;
        live.icon = chosenIcon;
      }
      card.heading = heading;
      card.body = body;
      card.icon = chosenIcon;
      this.rerender();
      this.host.focus();
    };
    const cancel = () => {
      editor.remove();
      this.host.focus();
    };
    h.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        b.focus();
      } else if (e.key === "Escape") cancel();
    });
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        cancel();
      } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        // Option/Alt + Up/Down moves the current line up or down.
        e.preventDefault();
        moveLine(b, e.key === "ArrowUp" ? -1 : 1);
      }
    });
    editor.addEventListener("focusout", (e) => {
      if (!editor.contains(e.relatedTarget as Node)) commit();
    });
  }

  // ---- Pointer interaction (drag to move / drag to link) -------------------

  private onCardPointerDown(e: PointerEvent, card: domain.Card) {
    e.stopPropagation();
    this.host.focus();
    this.selectedCardId = card.id;
    this.selectedLinkId = null;

    if (this.linkMode) {
      // In keyboard link mode the first card is the source; clicking a second
      // card completes the link.
      if (this.linkSourceId == null) {
        this.linkSourceId = card.id;
        this.setStatus(t("status.linkMode"));
        this.canvas.setSelectionClasses(this.selectedCardId, this.selectedLinkId);
      } else if (this.linkSourceId !== card.id) {
        const from = this.linkSourceId;
        this.linkSourceId = null;
        this.linkMode = false;
        this.tryCreateLink(from, card.id);
      }
      return;
    }

    // Remember the original position as a plain copy so we can snap back.
    this.dragState = {
      cardId: card.id,
      origX: card.x,
      origY: card.y,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    // Lightweight selection update (no DOM rebuild) so the browser can still
    // detect a double-click on the same element.
    this.canvas.setSelectionClasses(this.selectedCardId, this.selectedLinkId);
  }

  private onLinkClick(link: domain.Link) {
    this.selectedLinkId = link.id;
    this.selectedCardId = null;
    this.rerender();
    this.setStatus(
      link.childPlaneId
        ? "Linked plane — press D to drill in"
        : "Link selected — press D to drill into a new plane, Del to remove",
    );
  }

  private installCanvasEvents() {
    const svg = this.canvas.svg;

    svg.addEventListener("pointerdown", (e) => {
      // Background interaction.
      if ((e.target as Element).closest(".card")) return;
      this.selectedLinkId = null;
      if (e.shiftKey) {
        // Shift + drag on empty canvas = rubber-band multi-select.
        const w = this.canvas.toWorld(e.clientX, e.clientY);
        this.bandState = { startWX: w.x, startWY: w.y, additive: e.metaKey || e.ctrlKey };
        if (!this.bandState.additive) {
          this.selectedCardIds.clear();
          this.selectedCardId = null;
        }
        return;
      }
      // Plain drag = pan. Clicking empty space clears the multi-selection.
      if (this.selectedCardIds.size > 0) {
        this.selectedCardIds.clear();
        this.canvas.setSelectedSet(this.selectedCardIds);
        this.rerender();
      }
      this.panState = { x: e.clientX, y: e.clientY };
      svg.classList.add("panning");
    });

    // Double-click on empty canvas creates a new card at that position.
    svg.addEventListener("dblclick", (e) => {
      if ((e.target as Element).closest(".card")) return;
      const w = this.canvas.toWorld(e.clientX, e.clientY);
      this.addCardAt(w.x - CARD_W / 2, w.y - CARD_H / 2);
    });

    // Right-click on empty canvas opens the canvas context menu.
    svg.addEventListener("contextmenu", (e) => {
      if ((e.target as Element).closest(".card")) return;
      e.preventDefault();
      this.openCanvasContextMenu(e as MouseEvent);
    });

    svg.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.canvas.zoomAt(factor, e.offsetX, e.offsetY);
        this.saveViewState();
        this.updateMinimap();
      },
      { passive: false },
    );

    // Window-level listeners reference this.canvas dynamically, so attach them
    // only once even though the canvas is rebuilt on language change.
    if (this.windowEventsBound) return;
    this.windowEventsBound = true;

    window.addEventListener("pointermove", (e) => {
      this.lastMouse = { x: e.clientX, y: e.clientY };
      if (this.bandState) {
        const w = this.canvas.toWorld(e.clientX, e.clientY);
        this.canvas.drawBand(
          this.bandState.startWX,
          this.bandState.startWY,
          w.x - this.bandState.startWX,
          w.y - this.bandState.startWY,
        );
        return;
      }
      if (this.resizeState) {
        const view = this.canvas.getView();
        const rs = this.resizeState;
        const dw = (e.clientX - rs.startX) / view.zoom;
        const dh = (e.clientY - rs.startY) / view.zoom;
        const live = this.cards.find((c) => c.id === rs.cardId);
        if (live) {
          live.w = Math.max(120, rs.origW + dw);
          live.h = Math.max(70, rs.origH + dh);
          this.rerender();
        }
        return;
      }
      if (this.connectState) {
        const from = this.cards.find((c) => c.id === this.connectState!.fromCardId);
        if (from) {
          const p1 = anchorPoint(from, this.connectState.fromAnchor);
          const w = this.canvas.toWorld(e.clientX, e.clientY);
          this.canvas.drawTempLink(p1.x, p1.y, w.x, w.y);
        }
        return;
      }
      if (this.dragState) {
        const view = this.canvas.getView();
        const dx = (e.clientX - this.dragState.startX) / view.zoom;
        const dy = (e.clientY - this.dragState.startY) / view.zoom;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.dragState.moved = true;
        const live = this.cards.find((x) => x.id === this.dragState!.cardId);
        if (live) {
          live.x = this.dragState.origX + dx;
          live.y = this.dragState.origY + dy;
          this.rerender();
        }
      } else if (this.panState) {
        this.canvas.panBy(e.clientX - this.panState.x, e.clientY - this.panState.y);
        this.panState = { x: e.clientX, y: e.clientY };
        this.updateMinimap();
      }
    });

    window.addEventListener("pointerup", async (e) => {
      svg.classList.remove("panning");

      // Complete a rubber-band multi-select.
      if (this.bandState) {
        const bs = this.bandState;
        this.bandState = null;
        this.canvas.clearBand();
        const w = this.canvas.toWorld(e.clientX, e.clientY);
        const x1 = Math.min(bs.startWX, w.x);
        const y1 = Math.min(bs.startWY, w.y);
        const x2 = Math.max(bs.startWX, w.x);
        const y2 = Math.max(bs.startWY, w.y);
        if (!bs.additive) this.selectedCardIds.clear();
        for (const c of this.cards) {
          const cw = cardW(c);
          const ch = cardH(c);
          // Include a card if it intersects the band.
          if (c.x < x2 && c.x + cw > x1 && c.y < y2 && c.y + ch > y1) {
            this.selectedCardIds.add(c.id);
          }
        }
        this.selectedCardId =
          this.selectedCardIds.size === 1
            ? [...this.selectedCardIds][0]
            : this.selectedCardIds.size > 0
              ? null
              : this.selectedCardId;
        this.canvas.setSelectedSet(this.selectedCardIds);
        this.rerender();
        this.setStatus(
          this.selectedCardIds.size > 0
            ? `${this.selectedCardIds.size} ${t("sel.selected")}`
            : t("status.ready"),
        );
        return;
      }

      // Complete a card resize.
      if (this.resizeState) {
        const rs = this.resizeState;
        this.resizeState = null;
        const live = this.cards.find((c) => c.id === rs.cardId);
        if (live) {
          try {
            await App.ResizeCard(live.id, live.w, live.h);
          } catch (err) {
            this.setStatus(String(err));
          }
        }
        this.panState = null;
        return;
      }

      // Complete an anchor-drag connection.
      if (this.connectState) {
        const cs = this.connectState;
        this.connectState = null;
        this.canvas.clearTempLink();
        const hit = this.anchorAtScreen(e.clientX, e.clientY, cs.fromCardId);
        if (hit) {
          await this.tryCreateAnchoredLink(cs.fromCardId, cs.fromAnchor, hit.cardId, hit.anchor);
        } else {
          const target = this.cardAtScreen(e.clientX, e.clientY, cs.fromCardId);
          if (target) {
            await this.tryCreateAnchoredLink(cs.fromCardId, cs.fromAnchor, target.id, "center");
          } else {
            // Dropped into empty space: create a new card there and link to it.
            await this.createLinkedCardAt(cs.fromCardId, cs.fromAnchor, e.clientX, e.clientY);
          }
        }
        this.panState = null;
        return;
      }

      if (this.dragState) {
        const d = this.dragState;
        this.dragState = null;
        const live = this.cards.find((x) => x.id === d.cardId);
        if (live && d.moved) {
          // Did we drop onto another card? If so, create a link and snap back.
          const target = this.cardAtScreen(e.clientX, e.clientY, live.id);
          if (target) {
            live.x = d.origX;
            live.y = d.origY;
            this.rerender();
            await this.tryCreateLink(live.id, target.id);
          } else {
            await App.MoveCard(live.id, live.x, live.y);
            this.rerender();
          }
        }
      }
      this.panState = null;
      this.saveViewState();
    });

    // Keep the world point at the viewport center stable when the window
    // resizes, so the view stays correct.
    let lastSize = this.canvas.size();
    window.addEventListener("resize", () => {
      const prev = lastSize;
      const next = this.canvas.size();
      if (prev.w > 0 && prev.h > 0) {
        const view = this.canvas.getView();
        const centerWX = (prev.w / 2 - view.panX) / view.zoom;
        const centerWY = (prev.h / 2 - view.panY) / view.zoom;
        this.canvas.centerOn(centerWX, centerWY);
      }
      lastSize = next;
    });
  }

  // Find the card under the given screen point, excluding one id. Uses a DOM
  // hit-test first (respects what is actually drawn on top), then falls back to
  // world-coordinate geometry.
  private cardAtScreen(clientX: number, clientY: number, excludeId: number): domain.Card | null {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const g = (el as Element).closest(".card") as SVGGElement | null;
      if (g && g.dataset.cardId) {
        const id = Number(g.dataset.cardId);
        if (id !== excludeId) {
          const c = this.cards.find((x) => x.id === id);
          if (c) return c;
        }
      }
    }
    const w = this.canvas.toWorld(clientX, clientY);
    for (const c of this.cards) {
      if (c.id === excludeId) continue;
      if (w.x >= c.x && w.x <= c.x + CARD_W && w.y >= c.y && w.y <= c.y + CARD_H) return c;
    }
    return null;
  }

  private async tryCreateLink(fromId: number, toId: number) {
    try {
      const link = await App.CreateLink(fromId, toId);
      this.links.push(link);
      this.rerender();
      this.setStatus(t("status.ready"));
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  // Start an anchor-drag connection from a card's connection circle.
  private onAnchorPointerDown(_e: PointerEvent, card: domain.Card, anchor: Anchor) {
    this.host.focus();
    this.selectedCardId = card.id;
    this.selectedLinkId = null;
    this.connectState = { fromCardId: card.id, fromAnchor: anchor };
    const p = anchorPoint(card, anchor);
    this.canvas.drawTempLink(p.x, p.y, p.x, p.y);
  }

  // Start resizing a card from its bottom-right handle.
  private onResizePointerDown(e: PointerEvent, card: domain.Card) {
    this.host.focus();
    this.selectedCardId = card.id;
    this.selectedLinkId = null;
    this.resizeState = {
      cardId: card.id,
      startX: e.clientX,
      startY: e.clientY,
      origW: cardW(card),
      origH: cardH(card),
    };
  }

  // Create a new card at the drop point and link it to the source anchor.
  private async createLinkedCardAt(
    fromCardId: number,
    fromAnchor: Anchor,
    clientX: number,
    clientY: number,
  ) {
    const w = this.canvas.toWorld(clientX, clientY);
    try {
      const card = await App.CreateCard(this.planeId, w.x - CARD_W / 2, w.y - CARD_H / 2);
      this.cards.push(card);
      const link = await App.CreateLinkAnchored(fromCardId, card.id, fromAnchor, "center");
      this.links.push(link);
      this.selectedCardId = card.id;
      this.rerender();
      this.editCard(card);
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  // Find a connection anchor under a screen point (excluding one card).
  private anchorAtScreen(
    clientX: number,
    clientY: number,
    excludeCardId: number,
  ): { cardId: number; anchor: Anchor } | null {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const dot = el as SVGElement;
      if (dot.classList && dot.classList.contains("anchor-dot")) {
        const g = dot.closest(".card") as SVGGElement | null;
        if (g && g.dataset.cardId) {
          const id = Number(g.dataset.cardId);
          if (id !== excludeCardId) {
            return { cardId: id, anchor: (dot.dataset.anchor as Anchor) || "center" };
          }
        }
      }
    }
    return null;
  }

  private async tryCreateAnchoredLink(
    fromId: number,
    fromAnchor: Anchor,
    toId: number,
    toAnchor: Anchor,
  ) {
    try {
      const link = await App.CreateLinkAnchored(fromId, toId, fromAnchor, toAnchor);
      this.links.push(link);
      this.rerender();
      this.setStatus(t("status.ready"));
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  // ---- Context menus + clipboard -------------------------------------------

  // In-app text prompt (window.prompt is unreliable in the WKWebView).
  private textPrompt(message: string, initial = ""): Promise<string | null> {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "overlay";
      overlay.innerHTML = `
        <div class="panel" style="width:min(460px,90%)">
          <header><span>${escapeHtml(message)}</span></header>
          <div class="content">
            <input class="prompt-input" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;font:inherit" />
            <div style="margin-top:14px;text-align:right;display:flex;gap:8px;justify-content:flex-end">
              <button class="cancel">${t("dlg.cancel")}</button>
              <button class="ok primary">${t("dlg.ok")}</button>
            </div>
          </div>
        </div>`;
      this.host.appendChild(overlay);
      const input = overlay.querySelector(".prompt-input") as HTMLInputElement;
      input.value = initial;
      const done = (val: string | null) => {
        overlay.remove();
        this.host.focus();
        resolve(val);
      };
      overlay.querySelector(".ok")!.addEventListener("click", () => done(input.value));
      overlay.querySelector(".cancel")!.addEventListener("click", () => done(null));
      overlay.addEventListener("pointerdown", (e) => {
        if (e.target === overlay) done(null);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") done(input.value);
        else if (e.key === "Escape") done(null);
        e.stopPropagation();
      });
      input.focus();
    });
  }

  // In-app confirm dialog (window.confirm is unreliable in the WKWebView).
  private confirmDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "overlay";
      overlay.innerHTML = `
        <div class="panel" style="width:min(460px,90%)">
          <header><span>${escapeHtml(message)}</span></header>
          <div class="content">
            <div style="text-align:right;display:flex;gap:8px;justify-content:flex-end">
              <button class="cancel">${t("dlg.cancel")}</button>
              <button class="ok primary">${t("dlg.ok")}</button>
            </div>
          </div>
        </div>`;
      this.host.appendChild(overlay);
      const done = (val: boolean) => {
        overlay.remove();
        this.host.focus();
        resolve(val);
      };
      overlay.querySelector(".ok")!.addEventListener("click", () => done(true));
      overlay.querySelector(".cancel")!.addEventListener("click", () => done(false));
      overlay.addEventListener("pointerdown", (e) => {
        if (e.target === overlay) done(false);
      });
    });
  }

  private ctxDismiss: ((ev: PointerEvent) => void) | null = null;

  private closeContextMenu() {
    if (this.ctxDismiss) {
      window.removeEventListener("pointerdown", this.ctxDismiss, true);
      this.ctxDismiss = null;
    }
    this.host.querySelector(".context-menu")?.remove();
  }

  private showContextMenu(
    clientX: number,
    clientY: number,
    items: { label: string; disabled?: boolean; action: () => void; swatch?: string; checked?: boolean }[],
  ) {
    this.closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "context-menu";
    const rect = this.host.getBoundingClientRect();
    menu.style.left = `${clientX - rect.left}px`;
    menu.style.top = `${clientY - rect.top}px`;
    items.forEach((it) => {
      const b = document.createElement("button");
      const check = document.createElement("span");
      check.className = "ctx-check";
      check.textContent = it.checked ? "✓" : "";
      b.appendChild(check);
      if (it.swatch) {
        const sw = document.createElement("span");
        sw.className = "ctx-swatch";
        sw.style.background = it.swatch;
        b.appendChild(sw);
      }
      b.appendChild(document.createTextNode(it.label));
      if (it.disabled) b.disabled = true;
      b.addEventListener("click", () => {
        this.closeContextMenu();
        it.action();
      });
      menu.appendChild(b);
    });
    this.host.appendChild(menu);
    // Dismiss on next pointerdown outside the menu. Track the handler so a
    // previously-open menu's dismiss listener can't swallow clicks in a menu
    // that replaced it (e.g. the background-color submenu).
    const dismiss = (ev: PointerEvent) => {
      if (!menu.contains(ev.target as Node)) {
        this.closeContextMenu();
      }
    };
    this.ctxDismiss = dismiss;
    setTimeout(() => window.addEventListener("pointerdown", dismiss, true), 0);
  }

  private openCardContextMenu(e: MouseEvent, card: domain.Card) {
    this.selectedLinkId = null;

    // If the right-clicked card is part of a multi-selection, show a group menu
    // (copy / cut / delete the whole selection).
    if (this.selectedCardIds.size > 1 && this.selectedCardIds.has(card.id)) {
      const n = this.selectedCardIds.size;
      this.showContextMenu(e.clientX, e.clientY, [
        { label: `${t("ctx.copy")} (${n})`, action: () => this.copyCard(card.id) },
        { label: `${t("ctx.cut")} (${n})`, action: () => this.cutCard(card.id) },
        { label: `${t("ctx.delete")} (${n})`, action: () => this.deleteSelectedCard() },
      ]);
      return;
    }

    // Single-card menu: this card becomes the selection.
    this.selectedCardIds.clear();
    this.selectedCardId = card.id;
    this.canvas.setSelectedSet(this.selectedCardIds);
    this.rerender();
    const items: { label: string; disabled?: boolean; action: () => void }[] = [
      { label: t("ctx.copy"), action: () => this.copyCard(card.id) },
      { label: t("ctx.cut"), action: () => this.cutCard(card.id) },
      { label: t("ctx.copyLink"), action: () => this.copyDeepLink(card.id) },
      { label: t("tag.add"), action: () => this.addTagToSelected(card.id, e.clientX, e.clientY) },
      { label: t("tag.remove"), action: () => this.removeTagFromCard(e, card) },
      { label: t("card.bgColor"), action: () => this.openCardBgMenu(e.clientX, e.clientY, card) },
      { label: t("card.setDate"), action: () => this.openDatePicker(e, card) },
      { label: t("link.addUrl"), action: () => this.addUrlLink(card.id) },
      { label: t("link.addFile"), action: () => this.addFileLink(card.id) },
      { label: t("link.addFolder"), action: () => this.addFileLink(card.id, true) },
      { label: t("ctx.document"), action: () => this.openDocument(card) },
      { label: t("ctx.delete"), action: () => this.deleteSelectedCard() },
    ];
    // Existing links on the card: click to open.
    (card.links ?? []).forEach((lnk) => {
      items.push({
        label: `${lnk.kind === "file" ? "📁" : "🔗"} ${lnk.label}`,
        action: async () => {
          try {
            await App.OpenCardLink(lnk.id);
          } catch (err) {
            this.setStatus(String(err));
          }
        },
      });
    });
    this.showContextMenu(e.clientX, e.clientY, items);
  }

  private openCanvasContextMenu(e: MouseEvent) {
    const w = this.canvas.toWorld(e.clientX, e.clientY);
    this.showContextMenu(e.clientX, e.clientY, [
      {
        label: t("ctx.insert"),
        action: () => this.addCardAt(w.x - CARD_W / 2, w.y - CARD_H / 2),
      },
      {
        label: t("ctx.paste"),
        disabled: !this.clipboard,
        action: () => this.pasteCardAt(w.x - CARD_W / 2, w.y - CARD_H / 2),
      },
    ]);
  }

  // Ten named colors (used for links and tags).
  private readonly namedColors: { key: string; hex: string }[] = [
    { key: "red", hex: "#e53e3e" },
    { key: "orange", hex: "#dd6b20" },
    { key: "yellow", hex: "#d69e2e" },
    { key: "green", hex: "#38a169" },
    { key: "teal", hex: "#319795" },
    { key: "lightblue", hex: "#4299e1" },
    { key: "blue", hex: "#3182ce" },
    { key: "purple", hex: "#805ad5" },
    { key: "pink", hex: "#d53f8c" },
    { key: "gray", hex: "#718096" },
  ];

  private colorLabel(key: string): string {
    return t("color." + key) || key;
  }

  // Light background palette for cards (black text always stays readable).
  private readonly bgColors: { key: string; hex: string }[] = [
    { key: "white", hex: "#ffffff" },
    { key: "red", hex: "#fde8e8" },
    { key: "orange", hex: "#feecdc" },
    { key: "yellow", hex: "#fdf6b2" },
    { key: "green", hex: "#def7ec" },
    { key: "teal", hex: "#d5f5f6" },
    { key: "lightblue", hex: "#e1effe" },
    { key: "blue", hex: "#e6ecff" },
    { key: "purple", hex: "#edebfe" },
    { key: "pink", hex: "#fce8f3" },
    { key: "gray", hex: "#edf0f5" },
  ];

  // Date picker popup for a card (date only, no time).
  private openDatePicker(e: MouseEvent, card: domain.Card) {
    this.closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "context-menu date-popup";
    const rect = this.host.getBoundingClientRect();
    menu.style.left = `${e.clientX - rect.left}px`;
    menu.style.top = `${e.clientY - rect.top}px`;
    menu.innerHTML = `
      <input type="date" class="date-input" value="${escapeHtml(card.date || "")}" />
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="set primary">${t("dlg.ok")}</button>
        <button class="clear">${t("date.clear")}</button>
      </div>`;
    this.host.appendChild(menu);
    const input = menu.querySelector(".date-input") as HTMLInputElement;
    const apply = async (value: string) => {
      menu.remove();
      try {
        await App.SetCardDate(card.id, value);
        const live = this.cards.find((x) => x.id === card.id);
        if (live) live.date = value;
        card.date = value;
        this.rerender();
      } catch (err) {
        this.setStatus(String(err));
      }
    };
    menu.querySelector(".set")!.addEventListener("click", () => apply(input.value));
    menu.querySelector(".clear")!.addEventListener("click", () => apply(""));
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") apply(input.value);
      else if (ev.key === "Escape") menu.remove();
      ev.stopPropagation();
    });
    const dismiss = (ev: PointerEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        window.removeEventListener("pointerdown", dismiss, true);
      }
    };
    setTimeout(() => window.addEventListener("pointerdown", dismiss, true), 0);
    input.focus();
  }

  // Show a background-color picker for a card (light colors only).
  private openCardBgMenu(clientX: number, clientY: number, card: domain.Card) {
    const current = (card.bgColor || "#ffffff").toLowerCase();
    this.showContextMenu(
      clientX,
      clientY,
      this.bgColors.map((c) => ({
        label: this.colorLabel(c.key === "white" ? "white" : c.key),
        swatch: c.hex,
        checked: c.hex.toLowerCase() === current,
        action: async () => {
          try {
            await App.SetCardBg(card.id, c.hex);
            const live = this.cards.find((x) => x.id === card.id);
            if (live) live.bgColor = c.hex;
            card.bgColor = c.hex;
            this.rerender();
          } catch (err) {
            this.setStatus(String(err));
          }
        },
      })),
    );
  }

  private openLinkContextMenu(e: MouseEvent, link: domain.Link) {
    this.selectedLinkId = link.id;
    this.selectedCardId = null;
    this.rerender();

    const items: {
      label: string;
      disabled?: boolean;
      action: () => void;
      swatch?: string;
    }[] = [{ label: t("ctx.deleteLink"), action: () => this.deleteLink(link.id) }];
    // Width options 1, 4, 8.
    [1, 4, 8].forEach((wd) => {
      items.push({
        label: `${t("link.width")} ${wd}`,
        action: () => this.styleLink(link, link.color, wd),
      });
    });
    // Named color options (first six primaries are enough for links).
    this.namedColors.slice(0, 6).forEach((c) => {
      items.push({
        label: this.colorLabel(c.key),
        swatch: c.hex,
        action: () => this.styleLink(link, c.hex, link.width || 2),
      });
    });
    items.push({
      label: t("link.colorDefault"),
      action: () => this.styleLink(link, "", link.width || 2),
    });
    this.showContextMenu(e.clientX, e.clientY, items);
  }

  private async styleLink(link: domain.Link, color: string, width: number) {
    try {
      await App.SetLinkStyle(link.id, color, width);
      const live = this.links.find((l) => l.id === link.id);
      if (live) {
        live.color = color;
        live.width = width;
      }
      this.rerender();
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  private async deleteLink(id: number) {
    try {
      await App.DeleteLink(id);
      this.links = this.links.filter((l) => l.id !== id);
      if (this.selectedLinkId === id) this.selectedLinkId = null;
      this.rerender();
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  // Copy the external deep link (mmm://card/<id>) for a card to the clipboard.
  private async copyDeepLink(cardId: number) {
    try {
      const url = await App.CardDeepLink(cardId);
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // Fallback: temporary textarea + execCommand for older WebViews.
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          copied = document.execCommand("copy");
        } catch {
          copied = false;
        }
        ta.remove();
      }
      this.setStatus(copied ? `${t("ctx.copiedLink")} ${url}` : url);
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  private copyCard(cardId: number) {
    this.clipboard = { cardIds: this.effectiveSelection(cardId), mode: "copy" };
    this.setStatus(`${t("ctx.copied")} (${this.clipboard.cardIds.length})`);
  }

  private cutCard(cardId: number) {
    this.clipboard = { cardIds: this.effectiveSelection(cardId), mode: "cut" };
    this.setStatus(`${t("ctx.cut")} (${this.clipboard.cardIds.length})`);
  }

  // The set of cards an action applies to: the multi-selection if any, else the
  // single given/selected card.
  private effectiveSelection(fallbackId?: number): number[] {
    if (this.selectedCardIds.size > 0) return [...this.selectedCardIds];
    const id = fallbackId ?? this.selectedCardId;
    return id ? [id] : [];
  }

  // Paste the clipboard card(s) with their top-left anchored near world (x,y).
  // The relative layout of a group is preserved. For "cut", sources are removed.
  private async pasteCardAt(x: number, y: number) {
    if (!this.clipboard || this.clipboard.cardIds.length === 0) return;
    const { cardIds, mode } = this.clipboard;
    try {
      if (cardIds.length === 1) {
        const copy = await App.DuplicateCard(cardIds[0], this.planeId, x, y);
        this.cards.push(copy);
        this.selectedCardIds = new Set([copy.id]);
        this.selectedCardId = copy.id;
      } else {
        // Offset the whole group so its bounding-box top-left lands at (x,y).
        const srcCards = cardIds
          .map((id) => this.clipboardCard(id))
          .filter((c): c is domain.Card => !!c);
        let minX = Infinity;
        let minY = Infinity;
        for (const c of srcCards) {
          minX = Math.min(minX, c.x);
          minY = Math.min(minY, c.y);
        }
        const dx = x - (isFinite(minX) ? minX : 0);
        const dy = y - (isFinite(minY) ? minY : 0);
        const res = await App.DuplicateCards(cardIds, this.planeId, dx, dy);
        this.selectedCardIds = new Set((res.cards ?? []).map((c) => c.id));
        this.selectedCardId = null;
      }
      if (mode === "cut") {
        try {
          await App.DeleteCardsWithUndo(cardIds);
        } catch {
          /* sources may be on another plane; ignore */
        }
        this.clipboard = null;
      }
      await this.reloadPlane();
      this.canvas.setSelectedSet(this.selectedCardIds);
      this.rerender();
      this.setStatus(t("status.ready"));
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  // Look up a card for clipboard math (only valid on the current plane).
  private clipboardCard(id: number): domain.Card | undefined {
    return this.cards.find((c) => c.id === id);
  }

  // Paste at the last known mouse position (keyboard Cmd/Ctrl+V).
  private pasteAtCursor() {
    const w = this.canvas.toWorld(this.lastMouse.x || 100, this.lastMouse.y || 100);
    this.pasteCardAt(w.x - CARD_W / 2, w.y - CARD_H / 2);
  }

  // Add a URL link to a card: ask for the URL and a short label (<=16 chars).
  private async addUrlLink(cardId: number) {
    const target = await this.textPrompt(t("link.urlPrompt"));
    if (!target || !target.trim()) return;
    const label = (await this.textPrompt(t("link.labelPrompt"))) ?? "";
    try {
      await App.AddCardLink(cardId, label.trim(), target.trim(), "url");
      await this.reloadPlane();
      this.setStatus(t("link.added"));
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  // Add a file or folder link to a card via the native picker, then a label.
  private async addFileLink(cardId: number, folder = false) {
    try {
      const path = folder ? await App.PickDirectory() : await App.PickFile();
      if (!path) return;
      const label = (await this.textPrompt(t("link.labelPrompt"))) ?? "";
      await App.AddCardLink(cardId, label.trim(), path, "file");
      await this.reloadPlane();
      this.setStatus(t("link.added"));
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  // ---- Drill in ------------------------------------------------------------

  // Drill into the selected link (opens its plane) or the selected card (opens
  // the card's own child plane of further cards).
  private async drillIn() {
    if (this.selectedLinkId) {
      const link = this.links.find((l) => l.id === this.selectedLinkId);
      if (!link) return;
      await this.saveViewState();
      const from = this.cards.find((c) => c.id === link.fromCardId);
      const to = this.cards.find((c) => c.id === link.toCardId);
      const label = `${from?.heading ?? "?"} ↔ ${to?.heading ?? "?"}`;
      try {
        const plane = await App.OpenLinkPlane(link.id);
        await this.pushFrame(plane.plane.id, label);
        this.setStatus(t("status.ready"));
      } catch (err) {
        this.setStatus(String(err));
      }
      return;
    }
    const card = this.selectedCard();
    if (!card) return;
    await this.saveViewState();
    try {
      const plane = await App.OpenCardPlane(card.id);
      await this.pushFrame(plane.plane.id, card.heading || t("card.newHeading"));
      this.setStatus(t("status.ready"));
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  // Double-click on a card drills into its plane.
  private drillIntoCard(card: domain.Card) {
    this.selectedCardId = card.id;
    this.selectedLinkId = null;
    this.drillIn();
  }

  // Open the document (Markdown + attachments) of the selected card.
  private openSelectedDocument() {    const card = this.selectedCard();
    if (card) this.openDocument(card);
  }

  // ---- Detail view (title, text, icon, attachments, links) -----------------

  private async openDocument(card: domain.Card) {
    let attachments: domain.Attachment[] = [];
    let cardLinks: domain.CardLink[] = [];
    try {
      attachments = (await App.ListAttachments(card.id)) ?? [];
      cardLinks = (await App.ListCardLinks(card.id)) ?? [];
    } catch (err) {
      this.setStatus(String(err));
    }

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel">
        <header>
          <span>${t("doc.title")}</span>
          <span class="spacer"></span>
          <button class="primary save">${t("doc.save")}</button>
          <button class="close">✕</button>
        </header>
        <div class="content">
          <label class="fld-label">${t("doc.titleField")}</label>
          <input class="title-fld" />
          <label class="fld-label">${t("doc.bodyField")}</label>
          <textarea class="md"></textarea>
          <label class="fld-label">${t("menu.language") === "Sprache" ? "Icon" : "Icon"}</label>
          <div class="icon-row detail-icons"></div>
          <label class="fld-label">${t("card.bgColor")}</label>
          <div class="icon-row bg-row"></div>
          <label class="fld-label">${t("card.date")}</label>
          <input type="date" class="date-fld" style="padding:6px;border:1px solid var(--line);border-radius:6px;font:inherit" />
          <div class="attachments">
            <strong>${t("doc.attachments")}</strong>
            <ul class="att-list"></ul>
            <button class="add-att">＋ ${t("doc.addAttachment")}</button>
            <input type="file" class="file" style="display:none" />
          </div>
          <div class="attachments">
            <strong>${t("tag.heading")}</strong>
            <ul class="tag-list"></ul>
            <button class="add-tag-btn">＋ ${t("tag.add")}</button>
          </div>
          <div class="attachments">
            <strong>${t("link.heading")}</strong>
            <ul class="link-list"></ul>
            <button class="add-url">🔗 ${t("link.addUrl")}</button>
            <button class="add-file">📄 ${t("link.addFile")}</button>
            <button class="add-folder">📁 ${t("link.addFolder")}</button>
          </div>
        </div>
      </div>`;
    this.host.appendChild(overlay);

    const titleFld = overlay.querySelector(".title-fld") as HTMLInputElement;
    const ta = overlay.querySelector(".md") as HTMLTextAreaElement;
    titleFld.value = card.heading;
    ta.value = card.body;

    // Icon picker.
    const iconRow = overlay.querySelector(".detail-icons") as HTMLElement;
    let chosenIcon = card.icon || "note";
    ICON_NAMES.forEach((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon-btn";
      btn.title = name;
      btn.innerHTML = iconHtml(name, 16);
      if (name === chosenIcon) btn.classList.add("active");
      btn.addEventListener("click", () => {
        chosenIcon = name;
        iconRow.querySelectorAll(".icon-btn").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
      });
      iconRow.appendChild(btn);
    });

    // Background color picker (light colors only).
    const bgRow = overlay.querySelector(".bg-row") as HTMLElement;
    let chosenBg = card.bgColor || "#ffffff";
    this.bgColors.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bg-btn";
      btn.title = this.colorLabel(c.key === "white" ? "white" : c.key);
      btn.style.background = c.hex;
      if (c.hex === chosenBg) btn.classList.add("active");
      btn.addEventListener("click", () => {
        chosenBg = c.hex;
        bgRow.querySelectorAll(".bg-btn").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
      });
      bgRow.appendChild(btn);
    });

    // Date field value (date only).
    const dateFld = overlay.querySelector(".date-fld") as HTMLInputElement;
    dateFld.value = card.date || "";

    const close = () => {
      overlay.remove();
      this.host.focus();
    };
    overlay.querySelector(".close")!.addEventListener("click", (e) => {
      e.stopPropagation();
      close();
    });
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) close();
    });
    // Save title + body + icon back to the card so the main window updates.
    overlay.querySelector(".save")!.addEventListener("click", async (e) => {
      e.stopPropagation();
      const heading = titleFld.value.trim() || t("card.newHeading");
      const body = ta.value;
      try {
        await App.UpdateCard(card.id, heading, body);
        if (chosenIcon !== (card.icon || "note")) await App.SetCardIcon(card.id, chosenIcon);
        if (chosenBg !== (card.bgColor || "#ffffff")) await App.SetCardBg(card.id, chosenBg);
        if (dateFld.value !== (card.date || "")) await App.SetCardDate(card.id, dateFld.value);
      } catch (err) {
        this.setStatus(String(err));
      }
      const live = this.cards.find((c) => c.id === card.id);
      if (live) {
        live.heading = heading;
        live.body = body;
        live.icon = chosenIcon;
        live.bgColor = chosenBg;
        live.date = dateFld.value;
      }
      card.heading = heading;
      card.body = body;
      card.icon = chosenIcon;
      card.bgColor = chosenBg;
      card.date = dateFld.value;
      this.rerender();
      close();
    });

    // Attachments.
    const ul = overlay.querySelector(".att-list") as HTMLElement;
    const renderAtt = (list: domain.Attachment[] | null) => {
      ul.replaceChildren();
      (list ?? []).forEach((a) => {
        const li = document.createElement("li");
        const open = document.createElement("a");
        open.href = "#";
        open.textContent = `📎 ${shortenName(a.filename, 16)}`;
        open.title = a.filename;
        open.style.cursor = "pointer";
        open.addEventListener("click", (ev) => {
          ev.preventDefault();
          this.viewAttachment(a);
        });
        const size = document.createElement("span");
        size.style.color = "var(--muted)";
        size.textContent = formatSize(a.size);
        const spacer = document.createElement("span");
        spacer.className = "spacer";
        li.append(open, spacer, size);
        ul.appendChild(li);
      });
    };
    renderAtt(attachments);

    const fileInput = overlay.querySelector(".file") as HTMLInputElement;
    overlay.querySelector(".add-att")!.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const b64 = bytesToBase64(buf);
        await App.AddAttachment(card.id, f.name, f.type, b64);
        renderAtt((await App.ListAttachments(card.id)) ?? []);
        this.setStatus(`${t("doc.attachments")}: ${f.name}`);
      } catch (err) {
        this.setStatus(String(err));
      }
      fileInput.value = "";
    });

    // External links (URL / file).
    const linkUl = overlay.querySelector(".link-list") as HTMLElement;
    const renderLinks = (list: domain.CardLink[] | null) => {
      linkUl.replaceChildren();
      (list ?? []).forEach((l) => {
        const li = document.createElement("li");
        const open = document.createElement("a");
        open.href = "#";
        open.textContent = `${l.kind === "file" ? "📁" : "🔗"} ${l.label}`;
        open.title = l.target;
        open.style.cursor = "pointer";
        open.addEventListener("click", async (ev) => {
          ev.preventDefault();
          try {
            await App.OpenCardLink(l.id);
          } catch (err) {
            this.setStatus(String(err));
          }
        });
        const edit = document.createElement("button");
        edit.textContent = "✎";
        edit.title = t("link.editLabel");
        edit.style.marginLeft = "8px";
        edit.addEventListener("click", async () => {
          const label = await this.textPrompt(t("link.labelPrompt"), l.label || "");
          if (label === null) return;
          try {
            await App.SetCardLinkLabel(l.id, label.trim());
            renderLinks((await App.ListCardLinks(card.id)) ?? []);
            await this.reloadPlane();
          } catch (err) {
            this.setStatus(String(err));
          }
        });
        const del = document.createElement("button");
        del.textContent = "✕";
        del.style.marginLeft = "8px";
        del.addEventListener("click", async () => {
          await App.DeleteCardLink(l.id);
          renderLinks((await App.ListCardLinks(card.id)) ?? []);
          await this.reloadPlane();
        });
        const spacer = document.createElement("span");
        spacer.className = "spacer";
        li.append(open, spacer, edit, del);
        linkUl.appendChild(li);
      });
    };
    renderLinks(cardLinks);

    // Tags on this card.
    const tagUl = overlay.querySelector(".tag-list") as HTMLElement;
    const renderTags = (list: domain.Tag[] | null) => {
      tagUl.replaceChildren();
      (list ?? []).forEach((tg) => {
        const li = document.createElement("li");
        const chip = document.createElement("span");
        chip.textContent = tg.name;
        chip.style.background = tg.color || "#d69e2e";
        chip.style.padding = "1px 8px";
        chip.style.borderRadius = "4px";
        chip.style.color = "#1a202c";
        const del = document.createElement("button");
        del.textContent = "✕";
        del.style.marginLeft = "8px";
        del.addEventListener("click", async () => {
          await App.DetachTag(card.id, tg.id);
          const live = this.cards.find((c) => c.id === card.id);
          if (live) live.tags = (live.tags ?? []).filter((x) => x.id !== tg.id);
          card.tags = (card.tags ?? []).filter((x) => x.id !== tg.id);
          this.rerender();
          renderTags(card.tags ?? []);
        });
        const spacer = document.createElement("span");
        spacer.className = "spacer";
        li.append(chip, spacer, del);
        tagUl.appendChild(li);
      });
    };
    renderTags(card.tags ?? []);

    overlay.querySelector(".add-tag-btn")!.addEventListener("click", async (e) => {
      e.stopPropagation();
      // Choose from existing tags only; new tags are created in the tag view.
      let all: domain.Tag[] = [];
      try {
        all = (await App.ListTags()) ?? [];
      } catch {
        /* ignore */
      }
      const have = new Set((card.tags ?? []).map((x) => x.id));
      const available = all.filter((x) => !have.has(x.id));
      const ev = e as MouseEvent;
      if (available.length === 0) {
        this.showContextMenu(ev.clientX, ev.clientY, [
          {
            label: all.length === 0 ? t("tag.noneYet") : t("tag.allAttached"),
            disabled: true,
            action: () => {},
          },
        ]);
        return;
      }
      this.showContextMenu(
        ev.clientX,
        ev.clientY,
        available.map((tg) => ({
          label: tg.name,
          swatch: tg.color,
          action: async () => {
            await App.AttachTag(card.id, tg.id);
            if (!(card.tags ?? []).some((x) => x.id === tg.id)) {
              card.tags = [...(card.tags ?? []), tg];
              const live = this.cards.find((c) => c.id === card.id);
              if (live) live.tags = card.tags;
            }
            this.rerender();
            renderTags(card.tags ?? []);
          },
        })),
      );
    });

    overlay.querySelector(".add-url")!.addEventListener("click", async (e) => {
      e.stopPropagation();
      const target = (await this.textPrompt(t("link.urlPrompt"))) || "";
      if (!target.trim()) return;
      const label = (await this.textPrompt(t("link.labelPrompt"))) ?? "";
      try {
        await App.AddCardLink(card.id, label.trim(), target.trim(), "url");
        renderLinks((await App.ListCardLinks(card.id)) ?? []);
        await this.reloadPlane();
      } catch (err) {
        this.setStatus(String(err));
      }
    });
    overlay.querySelector(".add-file")!.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const path = await App.PickFile();
        if (!path) return;
        const label = (await this.textPrompt(t("link.labelPrompt"))) ?? "";
        await App.AddCardLink(card.id, label.trim(), path, "file");
        renderLinks((await App.ListCardLinks(card.id)) ?? []);
        await this.reloadPlane();
      } catch (err) {
        this.setStatus(String(err));
      }
    });
    overlay.querySelector(".add-folder")!.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const path = await App.PickDirectory();
        if (!path) return;
        const label = (await this.textPrompt(t("link.labelPrompt"))) ?? "";
        await App.AddCardLink(card.id, label.trim(), path, "file");
        renderLinks((await App.ListCardLinks(card.id)) ?? []);
        await this.reloadPlane();
      } catch (err) {
        this.setStatus(String(err));
      }
    });

    titleFld.focus();
    titleFld.select();
  }

  // View or open an attachment: images render inline, PDFs (and everything
  // else) open in the operating system's default viewer.
  private async viewAttachment(att: domain.Attachment) {
    const name = att.filename.toLowerCase();
    const isImage =
      att.mime.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
    const isPdf = att.mime === "application/pdf" || name.endsWith(".pdf");

    if (isImage) {
      try {
        const payload = await App.AttachmentData(att.id);
        this.showImageViewer(payload.filename, payload.mime || "image/png", payload.dataB64);
      } catch (err) {
        this.setStatus(String(err));
      }
      return;
    }
    if (isPdf) {
      try {
        await App.OpenAttachmentExternally(att.id);
        this.setStatus(`${att.filename}`);
      } catch (err) {
        this.setStatus(String(err));
      }
      return;
    }
    // Fallback: let the OS decide.
    try {
      await App.OpenAttachmentExternally(att.id);
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  // Inline image viewer overlay.
  private showImageViewer(filename: string, mime: string, dataB64: string) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const panel = document.createElement("div");
    panel.className = "panel";
    const header = document.createElement("header");
    header.innerHTML = `<span>${escapeHtml(filename)}</span><span class="spacer"></span>`;
    const closeBtn = document.createElement("button");
    closeBtn.className = "close";
    closeBtn.textContent = "✕";
    header.appendChild(closeBtn);
    const content = document.createElement("div");
    content.className = "content";
    content.style.textAlign = "center";
    const img = document.createElement("img");
    img.src = `data:${mime};base64,${dataB64}`;
    img.style.maxWidth = "100%";
    img.style.maxHeight = "70vh";
    content.appendChild(img);
    panel.append(header, content);
    overlay.appendChild(panel);
    this.host.appendChild(overlay);

    const close = () => overlay.remove();
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) close();
    });
  }

  // Interactive tag view: a separate plane where tags are luggage-tag chips you
  // can drag, connect to each other, recolor and delete.
  private async openTagView(focusTag?: domain.Tag) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel tagview-panel">
        <header>
          <span>${t("tag.view")}</span>
          <span class="spacer"></span>
          <button class="add-tag">＋ ${t("tag.add")}</button>
          <button class="close">✕</button>
        </header>
        <div class="content tagview-content">
          <svg class="tagview-svg"></svg>
          <div class="tagview-hint">${t("tag.hint")}</div>
        </div>
      </div>`;
    this.host.appendChild(overlay);
    const svg = overlay.querySelector(".tagview-svg") as SVGSVGElement;

    let close = () => overlay.remove();
    overlay.querySelector(".close")!.addEventListener("click", () => close());
    // Note: no outside-click close, so dragging inside works freely.

    let tags: domain.Tag[] = [];
    let rels: domain.TagRelation[] = [];
    let selectedTagId: number | null = focusTag?.id ?? null;

    const SVGNS = "http://www.w3.org/2000/svg";
    // Layout any tag that has no position yet, into the first free grid cell
    // not already occupied by a positioned tag.
    const place = () => {
      const occupied = new Set<string>();
      for (const tg of tags) {
        if (tg.x || tg.y) occupied.add(`${Math.round(tg.x)},${Math.round(tg.y)}`);
      }
      let cell = 0;
      for (const tg of tags) {
        if (tg.x || tg.y) continue;
        // Find the next free grid cell.
        let x = 0;
        let y = 0;
        do {
          x = 60 + (cell % 5) * 150;
          y = 60 + Math.floor(cell / 5) * 90;
          cell++;
        } while (occupied.has(`${x},${y}`));
        occupied.add(`${x},${y}`);
        tg.x = x;
        tg.y = y;
        App.MoveTag(tg.id, tg.x, tg.y);
      }
    };

    let dragTag: { id: number; dx: number; dy: number } | null = null;
    let lastTagClick: { id: number; time: number } | null = null;
    let linkMode = false;
    let linkSourceTag: number | null = null;
    const hint = overlay.querySelector(".tagview-hint") as HTMLElement;

    // "L" starts link mode (pick source tag, then target). Esc cancels.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "l" || ev.key === "L") {
        linkMode = true;
        linkSourceTag = selectedTagId; // may be null → first click picks source
        hint.textContent = t("tag.linkPick");
      } else if (ev.key === "Escape") {
        if (linkMode) {
          linkMode = false;
          linkSourceTag = null;
          hint.textContent = t("tag.hint");
        } else {
          close();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const origClose = close;
    close = () => {
      window.removeEventListener("keydown", onKey);
      origClose();
    };

    const svgPoint = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const render = () => {
      svg.replaceChildren();
      // Arrowhead marker (parent -> child direction).
      const defs = document.createElementNS(SVGNS, "defs");
      const marker = document.createElementNS(SVGNS, "marker");
      marker.setAttribute("id", "tagArrow");
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "9");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "7");
      marker.setAttribute("markerHeight", "7");
      marker.setAttribute("orient", "auto-start-reverse");
      const mpath = document.createElementNS(SVGNS, "path");
      mpath.setAttribute("d", "M0 0 L10 5 L0 10 z");
      mpath.setAttribute("fill", "#718096");
      marker.appendChild(mpath);
      defs.appendChild(marker);
      svg.appendChild(defs);

      const byId = new Map<number, domain.Tag>();
      tags.forEach((t) => byId.set(t.id, t));

      // Relations (arrow points from parent = fromTag to child = toTag).
      for (const r of rels) {
        const a = byId.get(r.fromTagId);
        const b = byId.get(r.toTagId);
        if (!a || !b) continue;
        // Shorten the line so the arrowhead sits just before the child chip.
        const x1 = a.x + 45;
        const y1 = a.y + 14;
        const x2 = b.x + 45;
        const y2 = b.y + 14;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const shorten = 48; // keep clear of the ~108px-wide chip center
        const ex = x2 - (dx / len) * shorten;
        const ey = y2 - (dy / len) * shorten;
        const line = document.createElementNS(SVGNS, "line");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(ex));
        line.setAttribute("y2", String(ey));
        line.setAttribute("stroke", "#718096");
        line.setAttribute("stroke-width", "2");
        line.setAttribute("marker-end", "url(#tagArrow)");
        line.style.cursor = "pointer";
        line.addEventListener("click", async () => {
          if (await this.confirmDialog(t("tag.unlink"))) {
            await App.UnlinkTags(r.fromTagId, r.toTagId);
            rels = (await App.GetTagView()).relations ?? [];
            render();
          }
        });
        svg.appendChild(line);
      }

      // Tag chips (luggage-tag: triangle left + rectangle right).
      for (const tg of tags) {
        const g = document.createElementNS(SVGNS, "g");
        g.setAttribute("transform", `translate(${tg.x} ${tg.y})`);
        g.style.cursor = "grab";

        const shape = document.createElementNS(SVGNS, "path");
        shape.setAttribute("d", "M0 14 L16 2 L108 2 L108 26 L16 26 Z");
        shape.setAttribute("fill", tg.color || "#d69e2e");
        shape.setAttribute("stroke", tg.id === selectedTagId ? "#2b6cb0" : "#00000022");
        shape.setAttribute("stroke-width", tg.id === selectedTagId ? "2.5" : "1");
        g.appendChild(shape);

        const hole = document.createElementNS(SVGNS, "circle");
        hole.setAttribute("cx", "14");
        hole.setAttribute("cy", "14");
        hole.setAttribute("r", "2.5");
        hole.setAttribute("fill", "#00000055");
        g.appendChild(hole);

        const label = document.createElementNS(SVGNS, "text");
        label.setAttribute("x", "24");
        label.setAttribute("y", "18");
        label.setAttribute("font-size", "12");
        label.setAttribute("fill", "#1a202c");
        label.textContent = tg.name;
        g.appendChild(label);

        // Pointerdown: in link mode, pick source then target; otherwise select
        // and (double-click) list cards or drag to move.
        g.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          selectedTagId = tg.id;
          // Link mode (started with "L"): first tag = source, second = target.
          if (linkMode) {
            if (linkSourceTag == null) {
              linkSourceTag = tg.id;
              hint.textContent = t("tag.linkPick");
              render();
            } else if (linkSourceTag !== tg.id) {
              const from = linkSourceTag;
              linkMode = false;
              linkSourceTag = null;
              App.LinkTags(from, tg.id).then(async () => {
                rels = (await App.GetTagView()).relations ?? [];
                hint.textContent = t("tag.hint");
                render();
              });
            }
            return;
          }
          const now = Date.now();
          if (lastTagClick && lastTagClick.id === tg.id && now - lastTagClick.time < 350) {
            lastTagClick = null;
            dragTag = null;
            this.showCardsWithTag(tg, () => close());
            return;
          }
          lastTagClick = { id: tg.id, time: now };
          dragTag = { id: tg.id, dx: svgPoint(e).x - tg.x, dy: svgPoint(e).y - tg.y };
          render();
        });
        g.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openTagChipMenu(e as MouseEvent, tg, async () => {
            const d = await App.GetTagView();
            tags = d.tags ?? [];
            rels = d.relations ?? [];
            render();
          });
        });
        svg.appendChild(g);
      }
    };

    svg.addEventListener("pointermove", (e) => {
      if (dragTag) {
        const p = svgPoint(e);
        const tg = tags.find((x) => x.id === dragTag!.id);
        if (tg) {
          tg.x = p.x - dragTag.dx;
          tg.y = p.y - dragTag.dy;
          render();
        }
      }
    });
    svg.addEventListener("pointerup", async () => {
      if (dragTag) {
        const tg = tags.find((x) => x.id === dragTag!.id);
        if (tg) await App.MoveTag(tg.id, tg.x, tg.y);
        dragTag = null;
      }
    });

    overlay.querySelector(".add-tag")!.addEventListener("click", async () => {
      const tag = await this.promptNewTag();
      if (!tag) return;
      const d = await App.GetTagView();
      tags = d.tags ?? [];
      rels = d.relations ?? [];
      place();
      render();
    });

    // Initial load.
    const data = await App.GetTagView();
    tags = data.tags ?? [];
    rels = data.relations ?? [];
    place();
    render();
  }

  // Show a list of all cards that carry a tag; clicking one navigates there.
  private async showCardsWithTag(tag: domain.Tag, closeTagView: () => void) {
    let cards: domain.Card[] = [];
    try {
      cards = (await App.CardsWithTag(tag.id)) ?? [];
    } catch (err) {
      this.setStatus(String(err));
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.style.zIndex = "30";
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.style.width = "min(460px, 90%)";
    panel.innerHTML = `
      <header>
        <span>${t("tag.cardsWith")}: ${escapeHtml(tag.name)}</span>
        <span class="spacer"></span>
        <button class="close">✕</button>
      </header>
      <div class="content"><ul class="backup-list"></ul></div>`;
    overlay.appendChild(panel);
    this.host.appendChild(overlay);
    const ul = panel.querySelector("ul")!;
    if (cards.length === 0) {
      const li = document.createElement("li");
      li.textContent = t("tag.noCards");
      ul.appendChild(li);
    }
    cards.forEach((c) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = c.heading || t("card.newHeading");
      a.style.cursor = "pointer";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        overlay.remove();
        closeTagView();
        this.navigateToCard(c.id);
      });
      li.appendChild(a);
      ul.appendChild(li);
    });
    const close = () => overlay.remove();
    panel.querySelector(".close")!.addEventListener("click", close);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) close();
    });
  }

  // Context menu for a tag chip in the tag view.
  private openTagChipMenu(e: MouseEvent, tag: domain.Tag, refresh: () => void) {
    const items: { label: string; action: () => void; swatch?: string }[] = [
      {
        label: t("tag.delete"),
        action: async () => {
          await App.DeleteTag(tag.id);
          refresh();
        },
      },
    ];
    this.namedColors.forEach((c) => {
      items.push({
        label: this.colorLabel(c.key),
        swatch: c.hex,
        action: async () => {
          await App.SetTagColor(tag.id, c.hex);
          refresh();
        },
      });
    });
    this.showContextMenu(e.clientX, e.clientY, items);
  }

  // Prompt for a new tag name (max 16 chars) and color, then create it.
  private async promptNewTag(): Promise<domain.Tag | null> {
    const name = await this.textPrompt(t("tag.namePrompt"));
    if (!name || !name.trim()) return null;
    try {
      // Default color: first palette entry; color can be changed later.
      return await App.CreateTag(name.trim().slice(0, 16), this.namedColors[2].hex);
    } catch (err) {
      this.setStatus(String(err));
      return null;
    }
  }

  // Attach an existing tag to a card. New tags are created only in the tag
  // view, so this shows a chooser of existing tags not yet on the card.
  private async addTagToSelected(cardId?: number, clientX?: number, clientY?: number) {
    const id = cardId ?? this.selectedCardId;
    if (!id) return;
    const card = this.cards.find((c) => c.id === id);
    if (!card) return;
    let all: domain.Tag[] = [];
    try {
      all = (await App.ListTags()) ?? [];
    } catch (err) {
      this.setStatus(String(err));
      return;
    }
    const have = new Set((card.tags ?? []).map((tg) => tg.id));
    const available = all.filter((tg) => !have.has(tg.id));
    const p = clientX != null && clientY != null ? { x: clientX, y: clientY } : this.cardScreenPoint(card);
    if (all.length === 0) {
      this.showContextMenu(p.x, p.y, [
        { label: t("tag.noneYet"), disabled: true, action: () => {} },
      ]);
      return;
    }
    if (available.length === 0) {
      this.showContextMenu(p.x, p.y, [
        { label: t("tag.allAttached"), disabled: true, action: () => {} },
      ]);
      return;
    }
    this.showContextMenu(
      p.x,
      p.y,
      available.map((tg) => ({
        label: tg.name,
        swatch: tg.color,
        action: async () => {
          try {
            await App.AttachTag(id, tg.id);
            if (!(card.tags ?? []).some((x) => x.id === tg.id)) {
              card.tags = [...(card.tags ?? []), tg];
              const live = this.cards.find((c) => c.id === id);
              if (live) live.tags = card.tags;
            }
            this.rerender();
            this.setStatus(t("tag.added"));
          } catch (err) {
            this.setStatus(String(err));
          }
        },
      })),
    );
  }

  // Remove a tag from a card via a chooser menu.
  private async removeTagFromCard(e: MouseEvent, card: domain.Card) {
    const tags = card.tags ?? [];
    if (tags.length === 0) {
      this.setStatus(t("tag.none"));
      return;
    }
    this.showContextMenu(
      e.clientX,
      e.clientY,
      tags.map((tg) => ({
        label: `✕ ${tg.name}`,
        swatch: tg.color,
        action: async () => {
          await App.DetachTag(card.id, tg.id);
          await this.reloadPlane();
        },
      })),
    );
  }

  // ---- Command bubble (text commands, English only) ------------------------

  private openCommandBar() {
    this.closeContextMenu();
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.style.width = "min(560px, 92%)";
    panel.innerHTML = `
      <header><span>💬 ${t("menu.command")}</span><span class="spacer"></span><button class="close">✕</button></header>
      <div class="content">
        <input class="cmd-input" placeholder="add card My idea" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;font:inherit" />
        <div class="cmd-status" style="margin-top:8px;color:var(--muted);font-size:12px;min-height:16px"></div>
        <div style="margin-top:10px;font-size:12px;color:var(--muted);line-height:1.6">
          <code>add card NAME</code><br>
          <code>add tag TAGNAME [CARDNAME]</code><br>
          <code>link NAME1 to NAME2</code><br>
          <code>edit TEXT</code><br>
          <code>add url https://…</code><br>
          <code>add file PATH</code> · <code>add folder PATH</code>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--muted)">↑ / ↓ — command history</div>
      </div>`;
    overlay.appendChild(panel);
    this.host.appendChild(overlay);
    const input = panel.querySelector(".cmd-input") as HTMLInputElement;
    const status = panel.querySelector(".cmd-status") as HTMLElement;
    const close = () => {
      overlay.remove();
      this.host.focus();
    };
    panel.querySelector(".close")!.addEventListener("click", close);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) close();
    });
    // History cursor: -1 = current (unsubmitted) draft; else index into
    // commandHistory while browsing with Up/Down.
    let histIdx = -1;
    let draft = "";
    input.addEventListener("keydown", async (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (this.commandHistory.length === 0) return;
        if (histIdx === -1) {
          draft = input.value;
          histIdx = this.commandHistory.length - 1;
        } else if (histIdx > 0) {
          histIdx--;
        }
        input.value = this.commandHistory[histIdx];
        input.setSelectionRange(input.value.length, input.value.length);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (histIdx === -1) return;
        if (histIdx < this.commandHistory.length - 1) {
          histIdx++;
          input.value = this.commandHistory[histIdx];
        } else {
          histIdx = -1;
          input.value = draft;
        }
        input.setSelectionRange(input.value.length, input.value.length);
        return;
      }
      if (e.key === "Enter") {
        const cmd = input.value.trim();
        if (!cmd) return;
        if (this.commandHistory[this.commandHistory.length - 1] !== cmd) {
          this.commandHistory.push(cmd);
          if (this.commandHistory.length > 100) this.commandHistory.shift();
        }
        histIdx = -1;
        draft = "";
        const result = await this.runCommand(cmd);
        status.textContent = result;
        if (!result.startsWith("Error")) {
          input.value = "";
        }
      }
    });
    input.focus();
  }

  // Parse and execute a single English command. Returns a status/error string.
  private async runCommand(cmd: string): Promise<string> {
    try {
      // add card NAME
      let m = /^add\s+card\s+(.+)$/i.exec(cmd);
      if (m) {
        const name = m[1].trim();
        const sel = this.selectedCard();
        const x = sel ? sel.x + CARD_W + 40 : 40;
        const y = sel ? sel.y : 40;
        const card = await App.CreateCard(this.planeId, x, y);
        await App.UpdateCard(card.id, name, "");
        await this.reloadPlane();
        this.selectedCardId = card.id;
        this.rerender();
        return `OK: added card "${name}"`;
      }
      // add tag TAGNAME [CARDNAME]  (TAGNAME has no spaces; CARDNAME may).
      // Attaches an existing tag; new tags are created only in the tag view.
      m = /^add\s+tag\s+(\S+)(?:\s+(.+))?$/i.exec(cmd);
      if (m) {
        const tagName = m[1].trim();
        const cardName = (m[2] ?? "").trim();
        // Resolve the target card: named card or the selected one.
        let target: domain.Card | undefined;
        if (cardName) {
          target = this.cardByHeading(cardName);
          if (!target) return `Error: card "${cardName}" not found on this plane`;
        } else {
          target = this.selectedCard();
          if (!target) return "Error: no card selected";
        }
        // Resolve the existing tag by name (case-insensitive).
        const all = (await App.ListTags()) ?? [];
        const tag = all.find((tg) => tg.name.toLowerCase() === tagName.toLowerCase());
        if (!tag) {
          return `Error: tag "${tagName}" does not exist — create it in the Tag view first`;
        }
        if ((target.tags ?? []).some((tg) => tg.id === tag.id)) {
          return `OK: "${target.heading}" already has tag "${tag.name}"`;
        }
        await App.AttachTag(target.id, tag.id);
        await this.reloadPlane();
        this.rerender();
        return `OK: tagged "${target.heading}" with "${tag.name}"`;
      }
      // link NAME1 to NAME2
      m = /^link\s+(.+?)\s+to\s+(.+)$/i.exec(cmd);
      if (m) {
        const a = this.cardByHeading(m[1].trim());
        const b = this.cardByHeading(m[2].trim());
        if (!a) return `Error: card "${m[1].trim()}" not found on this plane`;
        if (!b) return `Error: card "${m[2].trim()}" not found on this plane`;
        await this.tryCreateLink(a.id, b.id);
        return `OK: linked "${a.heading}" → "${b.heading}"`;
      }
      // edit TEXT  (append to the current card's body)
      m = /^edit\s+(.+)$/i.exec(cmd);
      if (m) {
        const c = this.selectedCard();
        if (!c) return "Error: no card selected";
        const body = c.body ? c.body + "\n" + m[1] : m[1];
        await App.UpdateCard(c.id, c.heading, body);
        c.body = body;
        const live = this.cards.find((x) => x.id === c.id);
        if (live) live.body = body;
        this.rerender();
        return `OK: edited "${c.heading}"`;
      }
      // add url / file / folder TARGET  (on the current card)
      m = /^add\s+(url|file|folder)\s+(.+)$/i.exec(cmd);
      if (m) {
        const c = this.selectedCard();
        if (!c) return "Error: no card selected";
        const kind = m[1].toLowerCase() === "url" ? "url" : "file";
        await App.AddCardLink(c.id, "", m[2].trim(), kind);
        await this.reloadPlane();
        this.rerender();
        return `OK: added ${m[1].toLowerCase()} link to "${c.heading}"`;
      }
      return "Error: unknown command (see the list below)";
    } catch (err) {
      return "Error: " + String(err);
    }
  }

  // Find a card on the current plane by exact heading (case-insensitive), else
  // a prefix match.
  private cardByHeading(name: string): domain.Card | undefined {
    const lower = name.toLowerCase();
    return (
      this.cards.find((c) => c.heading.toLowerCase() === lower) ||
      this.cards.find((c) => c.heading.toLowerCase().startsWith(lower))
    );
  }

  // ---- Help view -----------------------------------------------------------

  private openHelp() {
    this.closeContextMenu();
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.style.width = "min(720px, 92%)";
    panel.style.maxHeight = "85%";
    panel.innerHTML = `
      <header><span>? ${t("menu.help")}</span><span class="spacer"></span><button class="close">✕</button></header>
      <div class="content help-content">${HELP_HTML}</div>`;
    overlay.appendChild(panel);
    this.host.appendChild(overlay);
    const close = () => {
      overlay.remove();
      this.host.focus();
    };
    panel.querySelector(".close")!.addEventListener("click", close);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) close();
    });
  }

  // ---- Backup / restore ----------------------------------------------------

  // Settings dialog: configure the backup directory.
  private async openSettings() {
    let current = "";
    try {
      current = await App.GetBackupDir();
    } catch {
      /* ignore */
    }
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.style.width = "min(560px, 92%)";
    panel.innerHTML = `
      <header><span>${t("menu.settings")}</span><span class="spacer"></span><button class="close">✕</button></header>
      <div class="content">
        <label class="fld-label">${t("settings.backupDir")}</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="bdir" readonly style="flex:1;padding:8px;border:1px solid var(--line);border-radius:6px;font:inherit" />
          <button class="pick primary">${t("settings.choose")}</button>
        </div>
      </div>`;
    overlay.appendChild(panel);
    this.host.appendChild(overlay);
    const input = panel.querySelector(".bdir") as HTMLInputElement;
    input.value = current;
    const close = () => {
      overlay.remove();
      this.host.focus();
    };
    panel.querySelector(".close")!.addEventListener("click", close);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) close();
    });
    panel.querySelector(".pick")!.addEventListener("click", async () => {
      try {
        const dir = await App.PickBackupDir();
        if (dir) {
          input.value = dir;
          this.setStatus(t("settings.backupDirSet"));
        }
      } catch (err) {
        this.setStatus(String(err));
      }
    });
  }

  private backupNow() {
    // Ask for an optional title (max 32 characters) before creating the backup.
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
      <header><span>${t("menu.backup")}</span><span class="spacer"></span><button class="close">✕</button></header>
      <div class="content">
        <label style="display:block;margin-bottom:6px">${t("backup.titleLabel")}</label>
        <input class="title-input" maxlength="32" placeholder="${t(
          "backup.titlePlaceholder",
        )}" style="width:100%;padding:6px;border:1px solid var(--line);border-radius:6px;font:inherit" />
        <div style="margin-top:4px;color:var(--muted);font-size:12px"><span class="count">0</span>/32</div>
        <div style="margin-top:14px;text-align:right">
          <button class="go primary">${t("menu.backup")}</button>
        </div>
      </div>`;
    overlay.appendChild(panel);
    this.host.appendChild(overlay);

    const input = panel.querySelector(".title-input") as HTMLInputElement;
    const count = panel.querySelector(".count") as HTMLElement;
    input.addEventListener("input", () => {
      count.textContent = String(input.value.length);
    });
    const close = () => {
      overlay.remove();
      this.host.focus();
    };
    const run = async () => {
      const title = input.value.trim().slice(0, 32);
      close();
      try {
        const info = await App.BackupNow(title);
        this.setStatus(
          `${t("backup.done")} ${info.title ? info.title + " — " : ""}${info.filename}`,
        );
      } catch (err) {
        this.setStatus(String(err));
      }
    };
    panel.querySelector(".close")!.addEventListener("click", close);
    panel.querySelector(".go")!.addEventListener("click", run);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) close();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run();
      else if (e.key === "Escape") close();
    });
    input.focus();
  }

  private async openRestoreDialog() {
    const backups = await App.ListBackups();
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    const items = (backups ?? [])
      .map(
        (b) =>
          `<li><span>📦 ${b.title ? escapeHtml(b.title) + " " : ""}<span style="color:var(--muted)">${escapeHtml(
            b.filename,
          )}</span></span><span class="spacer"></span><span style="color:var(--muted)">${formatSize(
            b.size,
          )}</span><button class="primary do" data-path="${escapeHtml(b.path)}">${t(
            "menu.restore",
          )}</button></li>`,
      )
      .join("");
    overlay.innerHTML = `
      <div class="panel">
        <header><span>${t("backup.choose")}</span><span class="spacer"></span><button class="close">✕</button></header>
        <div class="content"><ul class="backup-list">${items || "<li>(no backups yet)</li>"}</ul></div>
      </div>`;
    this.host.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector(".close")!.addEventListener("click", close);
    overlay.addEventListener("pointerdown", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelectorAll(".do").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const path = (btn as HTMLElement).dataset.path!;
        try {
          await App.Restore(path);
        } catch (err) {
          this.setStatus(String(err));
          return;
        }
        close();
        // The restore is applied live — reload the deck from its root so the
        // restored content shows immediately (no restart needed).
        try {
          const root = await App.GetRootPlane();
          this.stack = [{ planeId: root.plane.id, label: t("app.title") }];
          this.selectedCardIds.clear();
          this.canvas.setSelectedSet(this.selectedCardIds);
          await this.loadFrame();
        } catch {
          /* ignore */
        }
        this.setStatus(t("backup.restored"));
      }),
    );
  }

  // ---- Keyboard ------------------------------------------------------------

  private installKeyboard() {
    window.addEventListener("keydown", (e) => {
      // Ignore when typing in inputs / textareas.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (this.host.querySelector(".overlay")) return;

      // Clipboard shortcuts (Cmd on macOS, Ctrl elsewhere).
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          e.preventDefault();
          this.undoLast();
          return;
        }
        if (k === "c" && (this.selectedCardId || this.selectedCardIds.size)) {
          e.preventDefault();
          this.copyCard(this.selectedCardId ?? 0);
          return;
        }
        if (k === "x" && (this.selectedCardId || this.selectedCardIds.size)) {
          e.preventDefault();
          this.cutCard(this.selectedCardId ?? 0);
          return;
        }
        if (k === "v") {
          e.preventDefault();
          this.pasteAtCursor();
          return;
        }
      }

      switch (e.key) {
        case "+":
        case "=":
          e.preventDefault();
          this.addCard();
          break;
        case "Enter": {
          const c = this.selectedCard();
          if (c) this.editCard(c);
          break;
        }
        case "Delete":
        case "Backspace":
          if (this.selectedLinkId) {
            App.DeleteLink(this.selectedLinkId).then(() => {
              this.links = this.links.filter((l) => l.id !== this.selectedLinkId);
              this.selectedLinkId = null;
              this.rerender();
            });
          } else {
            this.deleteSelectedCard();
          }
          break;
        case "l":
        case "L":
          // Start link mode from the selected card; next card click (or the
          // keyboard: select another card then press L again) completes it.
          this.linkMode = true;
          this.linkSourceId = this.selectedCardId;
          this.setStatus(t("status.linkMode"));
          break;
        case "d":
        case "D":
          this.drillIn();
          break;
        case "/":
          // Open the command bubble (chat).
          e.preventDefault();
          this.openCommandBar();
          break;
        case "u":
        case "U":
          this.drillOut();
          break;
        case "a":
        case "A":
          if (this.selectedCardId) {
            const sc = this.selectedCard();
            if (sc) {
              const p = this.cardScreenPoint(sc);
              this.showContextMenu(p.x, p.y, [
                { label: t("link.addUrl"), action: () => this.addUrlLink(sc.id) },
                { label: t("link.addFile"), action: () => this.addFileLink(sc.id) },
                { label: t("link.addFolder"), action: () => this.addFileLink(sc.id, true) },
              ]);
            }
          }
          break;
        case "e":
        case "E":
          this.openSelectedDocument();
          break;
        case "0":
        case "Home":
          e.preventDefault();
          this.centerOnRoot();
          this.saveViewState();
          break;
        case "f":
        case "F":
          App.ToggleFullscreen();
          break;
        case "w":
        case "W":
          this.fitToWindow();
          break;
        case "t":
        case "T":
          this.addTagToSelected();
          break;
        case "Escape":
          if (this.linkMode) {
            this.linkMode = false;
            this.linkSourceId = null;
            this.setStatus(t("status.ready"));
          } else {
            this.drillOut();
          }
          break;
        case "Tab":
          e.preventDefault();
          this.cycleSelection(e.shiftKey ? -1 : 1);
          break;
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) {
            // Shift + arrows moves the selected card.
            this.nudgeSelected(e.key, 40);
          } else {
            // Plain arrows navigate selection to the nearest card in that
            // direction.
            this.navigateSpatial(e.key);
          }
          break;
      }
    });
  }

  private cycleSelection(dir: number) {
    if (this.cards.length === 0) return;
    const idx = this.cards.findIndex((c) => c.id === this.selectedCardId);
    const next = (idx + dir + this.cards.length) % this.cards.length;
    this.selectedCardId = this.cards[next].id;
    this.selectedLinkId = null;
    this.rerender();
  }

  private async nudgeSelected(key: string, step: number) {
    const c = this.selectedCard();
    if (!c) return;
    if (key === "ArrowUp") c.y -= step;
    else if (key === "ArrowDown") c.y += step;
    else if (key === "ArrowLeft") c.x -= step;
    else if (key === "ArrowRight") c.x += step;
    this.rerender();
    await App.MoveCard(c.id, c.x, c.y);
  }

  // Move selection to the nearest card in the given direction (spatial nav).
  private navigateSpatial(key: string) {
    const cur = this.selectedCard();
    if (!cur) {
      if (this.cards.length) {
        this.selectedCardId = this.cards[0].id;
        this.rerender();
      }
      return;
    }
    const cx = cur.x + cardW(cur) / 2;
    const cy = cur.y + cardH(cur) / 2;
    let best: domain.Card | null = null;
    let bestScore = Infinity;
    for (const c of this.cards) {
      if (c.id === cur.id) continue;
      const dx = c.x + cardW(c) / 2 - cx;
      const dy = c.y + cardH(c) / 2 - cy;
      // Require the candidate to be in the pressed direction.
      let along = 0;
      let across = 0;
      if (key === "ArrowLeft") {
        if (dx >= -1) continue;
        along = -dx;
        across = Math.abs(dy);
      } else if (key === "ArrowRight") {
        if (dx <= 1) continue;
        along = dx;
        across = Math.abs(dy);
      } else if (key === "ArrowUp") {
        if (dy >= -1) continue;
        along = -dy;
        across = Math.abs(dx);
      } else {
        if (dy <= 1) continue;
        along = dy;
        across = Math.abs(dx);
      }
      // Prefer cards roughly in line (across penalized more than along).
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      this.selectedCardId = best.id;
      this.selectedLinkId = null;
      this.rerender();
    }
  }

  // Fit all cards into the current viewport (zoom + center to show everything).
  private fitToWindow() {
    if (this.cards.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of this.cards) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + cardW(c));
      maxY = Math.max(maxY, c.y + cardH(c));
    }
    const margin = 60;
    const w = maxX - minX + margin * 2;
    const h = maxY - minY + margin * 2;
    const size = this.canvas.size();
    if (w <= 0 || h <= 0 || size.w <= 0 || size.h <= 0) return;
    const zoom = Math.min(3, Math.max(0.25, Math.min(size.w / w, size.h / h)));
    this.canvas.centerOn((minX + maxX) / 2, (minY + maxY) / 2, zoom);
    this.rerender();
    this.saveViewState();
  }

  // ---- Minimap -------------------------------------------------------------

  // Toggle the minimap overlay in the upper-right of the canvas.
  private toggleMinimap() {
    this.minimapOn = !this.minimapOn;
    const btn = document.querySelector('[data-act="minimap"]') as HTMLButtonElement | null;
    if (btn) btn.classList.toggle("active", this.minimapOn);
    if (this.minimapOn) {
      this.buildMinimap();
      this.updateMinimap();
    } else {
      this.minimap?.root.remove();
      this.minimap = null;
    }
  }

  // Create the minimap DOM (once) and attach it to the canvas host.
  private buildMinimap() {
    if (this.minimap) return;
    const SVGNS = "http://www.w3.org/2000/svg";
    const root = document.createElement("div");
    root.className = "minimap";
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "minimap-svg");
    const cards = document.createElementNS(SVGNS, "g");
    const viewport = document.createElementNS(SVGNS, "rect");
    viewport.setAttribute("class", "minimap-viewport");
    svg.appendChild(cards);
    svg.appendChild(viewport);
    root.appendChild(svg);

    // Click/drag on the minimap re-centers the main view on that world point.
    const jump = (ev: PointerEvent) => {
      const w = this.minimapToWorld(ev);
      if (w) {
        this.canvas.centerOn(w.x, w.y);
        this.rerender();
        this.updateMinimap();
        this.saveViewState();
      }
    };
    svg.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      jump(e as PointerEvent);
      const move = (me: PointerEvent) => jump(me);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });

    this.host.appendChild(root);
    this.minimap = { root, svg, cards, viewport };
  }

  // World bounds covering all cards plus a margin (used to scale the minimap).
  private minimapBounds() {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const c of this.cards) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + cardW(c));
      maxY = Math.max(maxY, c.y + cardH(c));
    }
    if (!isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = CARD_W;
      maxY = CARD_H;
    }
    const margin = 80;
    return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
  }

  // Redraw the minimap: scaled cards + the current viewport rectangle. Cheap
  // enough to call on every render / pan / zoom.
  private updateMinimap() {
    if (!this.minimap || !this.minimapOn) return;
    const { minX, minY, maxX, maxY } = this.minimapBounds();
    const worldW = maxX - minX;
    const worldH = maxY - minY;
    // Fixed display size; the viewBox maps world coords into it.
    const mmW = 180;
    const mmH = Math.max(90, Math.min(160, (worldH / worldW) * mmW));
    this.minimap.svg.setAttribute("width", String(mmW));
    this.minimap.svg.setAttribute("height", String(mmH));
    this.minimap.svg.setAttribute("viewBox", `${minX} ${minY} ${worldW} ${worldH}`);
    this.minimap.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // Cards as small rounded rects.
    const SVGNS = "http://www.w3.org/2000/svg";
    this.minimap.cards.replaceChildren();
    for (const c of this.cards) {
      const r = document.createElementNS(SVGNS, "rect");
      r.setAttribute("x", String(c.x));
      r.setAttribute("y", String(c.y));
      r.setAttribute("width", String(cardW(c)));
      r.setAttribute("height", String(cardH(c)));
      r.setAttribute("rx", "6");
      r.setAttribute("class", c.isRoot ? "mm-card mm-root" : "mm-card");
      if (c.id === this.selectedCardId) r.classList.add("mm-selected");
      this.minimap.cards.appendChild(r);
    }

    // Viewport rectangle: the world region currently visible in the main canvas.
    const view = this.canvas.getView();
    const size = this.canvas.size();
    const vx = -view.panX / view.zoom;
    const vy = -view.panY / view.zoom;
    const vw = size.w / view.zoom;
    const vh = size.h / view.zoom;
    this.minimap.viewport.setAttribute("x", String(vx));
    this.minimap.viewport.setAttribute("y", String(vy));
    this.minimap.viewport.setAttribute("width", String(vw));
    this.minimap.viewport.setAttribute("height", String(vh));
  }

  // Map a pointer event over the minimap to a world coordinate.
  private minimapToWorld(ev: PointerEvent): { x: number; y: number } | null {
    if (!this.minimap) return null;
    const rect = this.minimap.svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const { minX, minY, maxX, maxY } = this.minimapBounds();
    const fx = (ev.clientX - rect.left) / rect.width;
    const fy = (ev.clientY - rect.top) / rect.height;
    return {
      x: minX + fx * (maxX - minX),
      y: minY + fy * (maxY - minY),
    };
  }
}

function escapeHtml(s: string): string {
  return (s ?? "").replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// shortenName keeps the end of a name (the most specific part), max n chars.
function shortenName(s: string, n: number): string {
  if (!s) return "";
  // Use the last path segment if it looks like a path.
  const parts = s.split(/[\\/]/).filter(Boolean);
  const tail = parts.length ? parts[parts.length - 1] : s;
  if (tail.length <= n) return tail;
  return "…" + tail.slice(tail.length - (n - 1));
}

// Move the line containing the caret up or down by one (Option/Alt + Arrow).
function moveLine(ta: HTMLTextAreaElement, dir: -1 | 1): void {
  const value = ta.value;
  const lines = value.split("\n");

  // Which line is the caret on?
  const caret = ta.selectionStart;
  let idx = 0;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const end = acc + lines[i].length; // position at end of line i
    if (caret <= end) {
      idx = i;
      break;
    }
    acc = end + 1; // + newline
    idx = i + 1;
  }

  const target = idx + dir;
  if (target < 0 || target >= lines.length) return;

  // Swap the two lines.
  const tmp = lines[idx];
  lines[idx] = lines[target];
  lines[target] = tmp;

  ta.value = lines.join("\n");

  // Put the caret at the start of the moved line's new position.
  let newStart = 0;
  for (let i = 0; i < target; i++) newStart += lines[i].length + 1;
  ta.selectionStart = newStart;
  ta.selectionEnd = newStart + lines[target].length;
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Help content (English). Describes commands and general functionality.
const HELP_HTML = `
  <h3>My Memory Master (m³)</h3>
  <p>A three-dimensional concept map. Cards live on a <b>canvas</b> (one 2D
  plane). You can go deeper (<b>drill down</b>) into a card to a new plane of
  its own cards, or into a link. Everything is stored locally.</p>

  <h3>Mouse</h3>
  <ul>
    <li><b>Double-click empty canvas</b> — new card.</li>
    <li><b>Double-click a card title</b> — drill down into the card.</li>
    <li><b>Double-click a card body</b> — edit the card text.</li>
    <li><b>Drag a card</b> — move it. <b>Drag a connection dot</b> to another card — connect them; drop on empty space — new linked card.</li>
    <li><b>Shift + drag</b> on empty canvas — rubber-band multi-select (cards + the links between them).</li>
    <li><b>Right-click</b> a card / link / canvas — context menu.</li>
    <li><b>Drag the ◢ handle</b> (bottom-right) — resize a card.</li>
    <li><b>Calendar icon</b> — set a date (green = future, blue = today, orange = past).</li>
  </ul>

  <h3>Keyboard</h3>
  <ul>
    <li><b>+</b> add card · <b>Enter</b> edit · <b>E</b> detail dialog</li>
    <li><b>D</b> drill down · <b>U</b> drill up · <b>Esc</b> back</li>
    <li><b>L</b> link mode (then pick the target card)</li>
    <li><b>A</b> add link (URL / file / folder)</li>
    <li><b>Arrows</b> move selection between cards · <b>Shift+Arrows</b> move the card</li>
    <li><b>0</b> center on root · <b>W</b> fit all to window · <b>F</b> fullscreen</li>
    <li><b>⌘/Ctrl+C / X / V</b> copy / cut / paste · <b>⌘/Ctrl+Z</b> undo · <b>Del</b> delete</li>
  </ul>

  <h3>Commands (💬 bubble, key <code>/</code>, English only)</h3>
  <ul>
    <li><code>add card NAME</code> — new card with that title</li>
    <li><code>add tag TAGNAME [CARDNAME]</code> — attach an existing tag to the selected card (or the named card)</li>
    <li><code>link NAME1 to NAME2</code> — connect two cards by title</li>
    <li><code>edit TEXT</code> — append text to the current card's description</li>
    <li><code>add url https://…</code> — add a URL link to the current card</li>
    <li><code>add file PATH</code> — add a file link to the current card</li>
    <li><code>add folder PATH</code> — add a folder link to the current card</li>
  </ul>

  <h3>Tags</h3>
  <p>Attach tags to cards (right-click → Add tag). Open the <b>Tag view</b> to
  arrange tags and connect them with <b>L</b> (pick two tags). Relations are
  directed parent→child: double-clicking a parent tag lists its cards <i>and</i>
  the cards of all tags below it.</p>

  <h3>Deep links</h3>
  <p>Right-click a card → <b>Copy deep link</b> gives a <code>mmm://card/&lt;id&gt;</code>
  URL that reopens the app at that exact card.</p>

  <h3>Backup</h3>
  <p>Backup now (with an optional title), automatic backup on exit, and Restore
  from the menu. The backup folder is configurable in Settings.</p>
`;

new Controller().start().catch((err) => {
  document.body.innerHTML = `<pre style="padding:20px;color:#b00">${String(err)}</pre>`;
});
