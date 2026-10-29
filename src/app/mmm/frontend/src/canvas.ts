// SVG canvas renderer for mmm. Draws cards (rounded rect, bold heading,
// divider, short body), links, and tag luggage-tags, and handles pan/zoom.
// Card dimensions in world units.
import { domain } from "../wailsjs/go/models";
import { iconSvg, IconName, ICON_NAMES } from "./icons";

export const CARD_W = 200;
export const CARD_H = 96;

const SVGNS = "http://www.w3.org/2000/svg";

export interface ViewState {
  panX: number;
  panY: number;
  zoom: number;
}

export function defaultView(): ViewState {
  return { panX: 0, panY: 0, zoom: 1 };
}

function el<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVGNS, name);
}

export interface RenderCallbacks {
  onCardPointerDown(e: PointerEvent, card: domain.Card): void;
  onTitleDblClick(card: domain.Card): void;
  onBodyDblClick(card: domain.Card): void;
  onDrillIconClick(card: domain.Card): void;
  onCardUpClick(card: domain.Card): void;
  onDateIconClick(e: MouseEvent, card: domain.Card): void;
  onCardContextMenu(e: MouseEvent, card: domain.Card): void;
  onLinkClick(link: domain.Link): void;
  onLinkContextMenu(e: MouseEvent, link: domain.Link): void;
  onCardLinkClick(link: domain.CardLink): void;
  onTagClick(tag: domain.Tag): void;
  onAnchorPointerDown(e: PointerEvent, card: domain.Card, anchor: Anchor): void;
  onResizePointerDown(e: PointerEvent, card: domain.Card): void;
}

export type Anchor = "center" | "left" | "right" | "top" | "bottom";

// Per-card size with fallback to the defaults (for cards created before resize
// existed, or when a value is missing).
export function cardW(c: domain.Card): number {
  return c.w && c.w > 0 ? c.w : CARD_W;
}
export function cardH(c: domain.Card): number {
  return c.h && c.h > 0 ? c.h : CARD_H;
}

// anchorPoint returns the world coordinates of a card's anchor.
export function anchorPoint(c: domain.Card, anchor: string): { x: number; y: number } {
  const w = cardW(c);
  const h = cardH(c);
  switch (anchor) {
    case "left":
      return { x: c.x, y: c.y + h / 2 };
    case "right":
      return { x: c.x + w, y: c.y + h / 2 };
    case "top":
      return { x: c.x + w / 2, y: c.y };
    case "bottom":
      return { x: c.x + w / 2, y: c.y + h };
    default:
      return { x: c.x + w / 2, y: c.y + h / 2 };
  }
}

// Anchor positions relative to a card of width w and height h.
function anchorOffsets(w: number, h: number): { anchor: Anchor; x: number; y: number }[] {
  return [
    { anchor: "center", x: w / 2, y: h / 2 },
    { anchor: "left", x: 0, y: h / 2 },
    { anchor: "right", x: w, y: h / 2 },
    { anchor: "top", x: w / 2, y: 0 },
    { anchor: "bottom", x: w / 2, y: h },
  ];
}

export class Canvas {
  readonly svg: SVGSVGElement;
  private gLinks: SVGGElement;
  private gCards: SVGGElement;
  private view: ViewState = defaultView();
  private cb: RenderCallbacks;

  constructor(host: HTMLElement, cb: RenderCallbacks) {
    this.cb = cb;
    this.svg = el("svg");
    this.svg.classList.add("canvas");
    this.gLinks = el("g");
    this.gCards = el("g");
    this.svg.appendChild(this.gLinks);
    this.svg.appendChild(this.gCards);
    host.appendChild(this.svg);
  }

  setView(v: ViewState) {
    this.view = v;
    this.applyTransform();
  }

  getView(): ViewState {
    return { ...this.view };
  }

  panBy(dx: number, dy: number) {
    this.view.panX += dx;
    this.view.panY += dy;
    this.applyTransform();
  }

  zoomAt(factor: number, cx: number, cy: number) {
    const prev = this.view.zoom;
    const next = Math.min(3, Math.max(0.25, prev * factor));
    // Keep the point under the cursor stable.
    const wx = (cx - this.view.panX) / prev;
    const wy = (cy - this.view.panY) / prev;
    this.view.zoom = next;
    this.view.panX = cx - wx * next;
    this.view.panY = cy - wy * next;
    this.applyTransform();
  }

  // Convert screen (client) coords to world coords.
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - this.view.panX) / this.view.zoom,
      y: (sy - this.view.panY) / this.view.zoom,
    };
  }

  // Current size of the drawing surface in screen pixels.
  size(): { w: number; h: number } {
    const rect = this.svg.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  // Center the view on a world point (wx, wy) at the given zoom (default: keep
  // current zoom).
  centerOn(wx: number, wy: number, zoom?: number) {
    const { w, h } = this.size();
    if (zoom !== undefined) this.view.zoom = Math.min(3, Math.max(0.25, zoom));
    this.view.panX = w / 2 - wx * this.view.zoom;
    this.view.panY = h / 2 - wy * this.view.zoom;
    this.applyTransform();
  }

  private applyTransform() {
    const tr = `translate(${this.view.panX} ${this.view.panY}) scale(${this.view.zoom})`;
    this.gLinks.setAttribute("transform", tr);
    this.gCards.setAttribute("transform", tr);
    if (this.tempLayer) this.tempLayer.setAttribute("transform", tr);
  }

  private tempLayer: SVGGElement | null = null;
  private mainCardId: number | null = null;
  private canGoUp = false;
  private selectedSet: Set<number> = new Set();
  private bandLayer: SVGGElement | null = null;

  // Provide the full multi-selection set (card ids) for highlighting.
  setSelectedSet(ids: Set<number>) {
    this.selectedSet = ids;
  }

  // Draw the rubber-band selection rectangle in world coordinates.
  drawBand(x: number, y: number, w: number, h: number) {
    if (!this.bandLayer) {
      this.bandLayer = el("g");
      this.svg.appendChild(this.bandLayer);
    }
    this.bandLayer.setAttribute(
      "transform",
      `translate(${this.view.panX} ${this.view.panY}) scale(${this.view.zoom})`,
    );
    this.bandLayer.replaceChildren();
    const r = el("rect");
    r.setAttribute("x", String(Math.min(x, x + w)));
    r.setAttribute("y", String(Math.min(y, y + h)));
    r.setAttribute("width", String(Math.abs(w)));
    r.setAttribute("height", String(Math.abs(h)));
    r.classList.add("select-band");
    this.bandLayer.appendChild(r);
  }

  clearBand() {
    if (this.bandLayer) this.bandLayer.replaceChildren();
  }

  // Draw a temporary rubber-band line (world coords) while connecting anchors.
  drawTempLink(x1: number, y1: number, x2: number, y2: number) {
    if (!this.tempLayer) {
      this.tempLayer = el("g");
      this.svg.appendChild(this.tempLayer);
      this.applyTransform();
    }
    this.tempLayer.replaceChildren();
    const line = el("line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.classList.add("link-line", "temp");
    this.tempLayer.appendChild(line);
  }

  clearTempLink() {
    if (this.tempLayer) this.tempLayer.replaceChildren();
  }

  // Update selection highlight without rebuilding the DOM (so two quick clicks
  // land on the same element and the browser can fire dblclick).
  setSelectionClasses(selectedCardId: number | null, _selectedLinkId: number | null) {
    this.gCards.querySelectorAll(".card").forEach((g) => {
      const id = Number((g as SVGGElement).dataset.cardId);
      g.classList.toggle("selected", id === selectedCardId || this.selectedSet.has(id));
    });
  }

  render(
    cards: domain.Card[],
    links: domain.Link[],
    selectedCardId: number | null,
    selectedLinkId: number | null,
    mainCardId: number | null = null,
    canGoUp = false,
  ) {
    this.mainCardId = mainCardId;
    this.canGoUp = canGoUp;
    const byId = new Map<number, domain.Card>();
    cards.forEach((c) => byId.set(c.id, c));

    // Links
    this.gLinks.replaceChildren();
    for (const l of links) {
      const a = byId.get(l.fromCardId);
      const b = byId.get(l.toCardId);
      if (!a || !b) continue;
      const p1 = anchorPoint(a, l.fromAnchor || "center");
      const p2 = anchorPoint(b, l.toAnchor || "center");
      const line = el("line");
      line.setAttribute("x1", String(p1.x));
      line.setAttribute("y1", String(p1.y));
      line.setAttribute("x2", String(p2.x));
      line.setAttribute("y2", String(p2.y));
      line.classList.add("link-line");
      if (l.childPlaneId) line.classList.add("has-child");
      if (l.id === selectedLinkId) line.classList.add("selected");
      // Use inline style (not a presentation attribute) so per-link color and
      // width win over the stylesheet's defaults.
      if (l.color) line.style.stroke = l.color;
      if (l.width && l.width > 0) line.style.strokeWidth = String(l.width);
      line.style.cursor = "pointer";
      line.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cb.onLinkClick(l);
      });
      line.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.cb.onLinkContextMenu(e as MouseEvent, l);
      });
      // Fatter invisible hit area for easier selection of thin lines.
      const hit = el("line");
      hit.setAttribute("x1", String(p1.x));
      hit.setAttribute("y1", String(p1.y));
      hit.setAttribute("x2", String(p2.x));
      hit.setAttribute("y2", String(p2.y));
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", "12");
      hit.style.cursor = "pointer";
      hit.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cb.onLinkClick(l);
      });
      hit.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.cb.onLinkContextMenu(e as MouseEvent, l);
      });
      this.gLinks.appendChild(hit);
      this.gLinks.appendChild(line);
    }

    // Cards
    this.gCards.replaceChildren();
    for (const c of cards) {
      const sel = c.id === selectedCardId || this.selectedSet.has(c.id);
      this.gCards.appendChild(this.renderCard(c, sel));
    }
  }

  // Convert a mouse event to coordinates local to a card's origin.
  private localPoint(e: MouseEvent, c: domain.Card): { x: number; y: number } {
    const w = this.toWorld(e.clientX, e.clientY);
    return { x: w.x - c.x, y: w.y - c.y };
  }

  private renderCard(c: domain.Card, selected: boolean): SVGGElement {
    const W = cardW(c);
    const H = cardH(c);
    const g = el("g");
    g.classList.add("card");
    if (selected) g.classList.add("selected");
    if (c.isRoot) g.classList.add("root");
    g.setAttribute("transform", `translate(${c.x} ${c.y})`);
    g.dataset.cardId = String(c.id);

    const rect = el("rect");
    rect.setAttribute("width", String(W));
    rect.setAttribute("height", String(H));
    rect.setAttribute("rx", "12");
    rect.setAttribute("ry", "12");
    rect.classList.add("card-rect");
    if (c.bgColor && c.bgColor !== "#ffffff") rect.style.fill = c.bgColor;
    g.appendChild(rect);

    const heading = el("text");
    heading.setAttribute("x", "12");
    heading.setAttribute("y", "24");
    heading.classList.add("card-heading");
    const headMax = Math.max(5, Math.floor((W - 70) / 8));
    heading.textContent = truncate(c.heading, headMax);
    g.appendChild(heading);

    // Title hit-zone marker (kept for visual/debug; actual dblclick handling is
    // coordinate-based on the group below).
    const divider = el("line");
    divider.setAttribute("x1", "10");
    divider.setAttribute("y1", "34");
    divider.setAttribute("x2", String(W - 10));
    divider.setAttribute("y2", "34");
    divider.classList.add("card-divider");
    g.appendChild(divider);

    // Body, rendered as lightweight Markdown via a foreignObject.
    const fo = el("foreignObject");
    fo.setAttribute("x", "10");
    fo.setAttribute("y", "38");
    fo.setAttribute("width", String(W - 20));
    fo.setAttribute("height", String(H - 48));
    const body = document.createElement("div");
    body.className = "card-body-md";
    body.innerHTML = renderMarkdown(c.body);
    fo.appendChild(body);
    g.appendChild(fo);

    // Type icon, top-right.
    const icon = iconSvg(iconForCard(c));
    if (icon) {
      icon.setAttribute("x", String(W - 28));
      icon.setAttribute("y", "8");
      icon.setAttribute("width", "18");
      icon.setAttribute("height", "18");
      g.appendChild(icon);
    }

    // Date badge directly before the calendar icon. Background color signals
    // due state: green = future, blue = today, orange = past (overdue).
    if (c.date) {
      const state = dueState(c.date);
      const badgeW = c.date.length * 6 + 10; // ~6px per char
      const badgeX = W - 54 - badgeW;
      const badge = el("g");
      badge.setAttribute("transform", `translate(${badgeX} 6)`);
      const bg = el("rect");
      bg.setAttribute("width", String(badgeW));
      bg.setAttribute("height", "16");
      bg.setAttribute("rx", "4");
      bg.setAttribute("ry", "4");
      bg.setAttribute("fill", state.bg);
      badge.appendChild(bg);
      const dateText = el("text");
      dateText.setAttribute("x", String(badgeW / 2));
      dateText.setAttribute("y", "12");
      dateText.setAttribute("text-anchor", "middle");
      dateText.classList.add("card-date");
      dateText.style.fill = state.fg;
      dateText.textContent = c.date;
      badge.appendChild(dateText);
      g.appendChild(badge);
    }

    // Calendar icon (set a date), left of the type icon.
    const cal = el("g");
    cal.setAttribute("transform", `translate(${W - 50} 8)`);
    cal.setAttribute("data-ctl", "calendar");
    cal.style.cursor = "pointer";
    const calHit = el("rect");
    calHit.setAttribute("x", "-2");
    calHit.setAttribute("y", "-2");
    calHit.setAttribute("width", "20");
    calHit.setAttribute("height", "20");
    calHit.setAttribute("fill", "transparent");
    cal.appendChild(calHit);
    const calIcon = el("path");
    // Small calendar glyph.
    calIcon.setAttribute(
      "d",
      "M1 3h14v12H1zM1 6h14M4 1v3M12 1v3",
    );
    calIcon.setAttribute("fill", "none");
    calIcon.setAttribute("stroke", c.date ? "#2b6cb0" : "#a0aec0");
    calIcon.setAttribute("stroke-width", "1.4");
    calIcon.setAttribute("stroke-linecap", "round");
    calIcon.setAttribute("stroke-linejoin", "round");
    cal.appendChild(calIcon);
    const calTitle = el("title");
    calTitle.textContent = c.date || "Set date";
    cal.appendChild(calTitle);
    cal.addEventListener("pointerdown", (e) => e.stopPropagation());
    cal.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cb.onDateIconClick(e as MouseEvent, c);
    });
    g.appendChild(cal);

    // Drill-in icon in the title bar (click to go one level deeper). Placed
    // left of the calendar icon.
    const drill = el("g");
    drill.setAttribute("transform", `translate(${W - 74} 8)`);
    drill.setAttribute("data-ctl", "drill");
    drill.style.cursor = "pointer";
    const drillHit = el("rect");
    drillHit.setAttribute("x", "-2");
    drillHit.setAttribute("y", "-2");
    drillHit.setAttribute("width", "22");
    drillHit.setAttribute("height", "22");
    drillHit.setAttribute("fill", "transparent");
    drill.appendChild(drillHit);
    const drillIcon = el("path");
    // Downward "go deeper" chevrons.
    drillIcon.setAttribute("d", "M4 5 L9 10 L14 5 M4 10 L9 15 L14 10");
    drillIcon.setAttribute("fill", "none");
    drillIcon.setAttribute("stroke", "#2b6cb0");
    drillIcon.setAttribute("stroke-width", "1.8");
    drillIcon.setAttribute("stroke-linecap", "round");
    drillIcon.setAttribute("stroke-linejoin", "round");
    drill.appendChild(drillIcon);
    const title = el("title");
    title.textContent = "Drill in";
    drill.appendChild(title);
    drill.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
    });
    drill.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cb.onDrillIconClick(c);
    });
    g.appendChild(drill);

    // The view's main card also gets an Up button (go one level up), left of
    // the Down button.
    if (this.mainCardId != null && c.id === this.mainCardId && this.canGoUp) {
      const up = el("g");
      up.setAttribute("transform", `translate(${W - 98} 8)`);
      up.setAttribute("data-ctl", "up");
      up.style.cursor = "pointer";
      const upHit = el("rect");
      upHit.setAttribute("x", "-2");
      upHit.setAttribute("y", "-2");
      upHit.setAttribute("width", "22");
      upHit.setAttribute("height", "22");
      upHit.setAttribute("fill", "transparent");
      up.appendChild(upHit);
      const upIcon = el("path");
      // Upward "go up" chevrons.
      upIcon.setAttribute("d", "M4 10 L9 5 L14 10 M4 15 L9 10 L14 15");
      upIcon.setAttribute("fill", "none");
      upIcon.setAttribute("stroke", "#718096");
      upIcon.setAttribute("stroke-width", "1.8");
      upIcon.setAttribute("stroke-linecap", "round");
      upIcon.setAttribute("stroke-linejoin", "round");
      up.appendChild(upIcon);
      const upTitle = el("title");
      upTitle.textContent = "Up";
      up.appendChild(upTitle);
      up.addEventListener("pointerdown", (e) => e.stopPropagation());
      up.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cb.onCardUpClick(c);
      });
      g.appendChild(up);
    }

    // Tags along the bottom edge.
    (c.tags ?? []).forEach((tag, i) => {
      g.appendChild(this.renderTagChip(tag, 12 + i * 54, H - 18));
    });

    // External links, shown shortened near the bottom-left, above the tags.
    (c.links ?? []).slice(0, 2).forEach((lnk, i) => {
      const t2 = el("text");
      t2.setAttribute("x", "12");
      t2.setAttribute("y", String(H - 34 - i * 13));
      t2.classList.add("card-link-label");
      t2.textContent = (lnk.kind === "file" ? "📁 " : "🔗 ") + shortLinkLabel(lnk);
      t2.style.cursor = "pointer";
      const title = el("title");
      title.textContent = lnk.target;
      t2.appendChild(title);
      t2.addEventListener("click", (e) => {
        e.stopPropagation();
        this.cb.onCardLinkClick(lnk);
      });
      g.appendChild(t2);
    });

    // Drill-in indicator when the card has a child plane.
    if (c.childPlaneId) {
      const mark = el("path");
      mark.setAttribute("d", `M${W - 20} 6 L${W - 6} 6 L${W - 6} 20 Z`);
      mark.setAttribute("fill", "#2b6cb0");
      mark.setAttribute("opacity", "0.7");
      g.appendChild(mark);
    }

    // Connection circles at the five anchor positions.
    for (const a of anchorOffsets(W, H)) {
      const dot = el("circle");
      dot.setAttribute("cx", String(a.x));
      dot.setAttribute("cy", String(a.y));
      dot.setAttribute("r", "5");
      dot.classList.add("anchor-dot");
      dot.dataset.anchor = a.anchor;
      dot.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        this.cb.onAnchorPointerDown(e as PointerEvent, c, a.anchor);
      });
      g.appendChild(dot);
    }

    // Resize handle, bottom-right corner.
    const resize = el("path");
    resize.setAttribute("d", `M${W - 16} ${H - 4} L${W - 4} ${H - 16} M${W - 10} ${H - 4} L${W - 4} ${H - 10}`);
    resize.classList.add("resize-handle");
    resize.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.cb.onResizePointerDown(e as PointerEvent, c);
    });
    g.appendChild(resize);

    g.addEventListener("pointerdown", (e) => this.cb.onCardPointerDown(e, c));
    // Native double-click: decide title vs body by local Y. Ignore the
    // interactive controls (connect dots, drill/up/calendar, resize).
    g.addEventListener("dblclick", (e) => {
      const target = e.target as Element;
      if (
        target.closest(".anchor-dot") ||
        target.closest(".resize-handle") ||
        target.closest("[data-ctl]")
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const pt = this.localPoint(e as MouseEvent, c);
      if (pt.y <= 32) this.cb.onTitleDblClick(c);
      else this.cb.onBodyDblClick(c);
    });
    g.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cb.onCardContextMenu(e as MouseEvent, c);
    });
    return g;
  }

  private renderTagChip(tag: domain.Tag, x: number, y: number): SVGGElement {
    const g = el("g");
    g.setAttribute("transform", `translate(${x} ${y})`);
    g.style.cursor = "pointer";
    const label = truncate(tag.name, 7);
    const w = 20 + label.length * 5.5;

    const chip = el("path");
    // Luggage-tag shape: notch on the left.
    chip.setAttribute(
      "d",
      `M6 0 L${w} 0 L${w} 14 L6 14 L0 7 Z`,
    );
    chip.classList.add("tag-chip");
    if (tag.color) chip.setAttribute("fill", tag.color);
    g.appendChild(chip);

    const hole = el("circle");
    hole.setAttribute("cx", "6");
    hole.setAttribute("cy", "7");
    hole.setAttribute("r", "1.5");
    hole.setAttribute("fill", "#744210");
    g.appendChild(hole);

    const txt = el("text");
    txt.setAttribute("x", "11");
    txt.setAttribute("y", "10");
    txt.classList.add("tag-label");
    txt.textContent = label;
    g.appendChild(txt);

    g.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cb.onTagClick(tag);
    });
    return g;
  }
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// dueState returns background/foreground colors for a card date badge:
// green = date still in the future, blue = today, orange = past (overdue).
function dueState(dateStr: string): { bg: string; fg: string } {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  if (dateStr === todayKey) return { bg: "#3182ce", fg: "#ffffff" }; // today = blue
  // Compare as plain YYYY-MM-DD strings (lexicographic == chronological).
  if (dateStr > todayKey) return { bg: "#38a169", fg: "#ffffff" }; // future = green
  return { bg: "#dd6b20", fg: "#ffffff" }; // past = orange (overdue)
}

// shortLinkLabel returns the stored short label (already <=16 chars). Labels of
// 16 chars or fewer are shown in full; only longer fallbacks are shortened.
function shortLinkLabel(l: domain.CardLink): string {
  if (l.label && l.label.trim()) {
    return l.label.length <= 16 ? l.label : l.label.slice(0, 16);
  }
  let s = l.target || "";
  if (l.kind === "file") {
    const parts = s.split(/[\\/]/).filter(Boolean);
    s = parts[parts.length - 1] || s;
  } else {
    s = s.replace(/^[a-z]+:\/\//i, "");
  }
  return s.length > 16 ? "…" + s.slice(s.length - 15) : s;
}

// iconForCard returns the icon name stored on the card (defaulting to "note").
function iconForCard(c: domain.Card): IconName {
  const icon = (c.icon ?? "").toLowerCase();
  return (ICON_NAMES as string[]).includes(icon) ? (icon as IconName) : "note";
}

// renderMarkdown converts a small subset of Markdown to safe HTML for the card
// body: headings (#), bold (**x**), italics (*x*), and bullet lists (- / *).
function renderMarkdown(src: string): string {
  if (!src) return "";
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) =>
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
    );

  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  const lines = src.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<div class="md-h md-h${level}">${inline(h[2])}</div>`);
    } else if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
    } else if (line === "") {
      closeList();
    } else {
      closeList();
      out.push(`<div>${inline(line)}</div>`);
    }
  }
  closeList();
  return out.join("");
}
