// Card type icons for mmm. These are simple, Material-style glyphs drawn with
// SVG paths (inspired by Google Material Symbols, which are Apache-2.0) so they
// render crisply at small sizes without bundling a font.

export type IconName = "note" | "project" | "factory" | "calendar" | "idea" | "app";

export const ICON_NAMES: IconName[] = ["note", "project", "factory", "calendar", "idea", "app"];

const SVGNS = "http://www.w3.org/2000/svg";

// Path data drawn on a 24x24 viewBox, stroke-based for a light Material look.
const PATHS: Record<IconName, string> = {
  // Note: a sheet with lines and a folded corner.
  note: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 15h6M9 18h4",
  // Project: stacked folder/kanban columns.
  project: "M4 5h16v14H4zM4 9h16M9 9v10M15 9v10",
  // Factory: roofline with chimney.
  factory: "M3 20V11l5 3V11l5 3V7l5 3v10zM6 20v-3M11 20v-3M16 20v-3",
  // Calendar: grid with header and binding rings.
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2M14 17h2",
  // Idea: lightbulb with filament and base.
  idea: "M9 18h6M10 21h4M12 3a6 6 0 0 1 4 10c-1 1-1 2-1 3H9c0-1 0-2-1-3a6 6 0 0 1 4-10z",
  // App / tool: gear with a center hole and eight teeth.
  app: "M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1",
};

// iconSvg returns an SVG <svg> element for the given icon, or null.
export function iconSvg(name: IconName | null): SVGSVGElement | null {
  if (!name) return null;
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  if (name === "app") {
    svg.appendChild(mCubedNode());
    return svg;
  }
  if (!PATHS[name]) return null;
  const path = document.createElementNS(SVGNS, "path");
  path.setAttribute("d", PATHS[name]);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#4a5568");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

// mCubedNode draws the "m³" brand glyph (lowercase m with a superscript 3).
function mCubedNode(): SVGGElement {
  const g = document.createElementNS(SVGNS, "g");
  const m = document.createElementNS(SVGNS, "text");
  m.setAttribute("x", "2");
  m.setAttribute("y", "19");
  m.setAttribute("font-size", "17");
  m.setAttribute("font-weight", "700");
  m.setAttribute("font-family", "-apple-system, Segoe UI, Roboto, sans-serif");
  m.setAttribute("fill", "#4a5568");
  m.textContent = "m";
  const three = document.createElementNS(SVGNS, "text");
  three.setAttribute("x", "15");
  three.setAttribute("y", "10");
  three.setAttribute("font-size", "10");
  three.setAttribute("font-weight", "700");
  three.setAttribute("font-family", "-apple-system, Segoe UI, Roboto, sans-serif");
  three.setAttribute("fill", "#4a5568");
  three.textContent = "3";
  g.appendChild(m);
  g.appendChild(three);
  return g;
}

// iconHtml returns an inline SVG string (for menus / HTML contexts).
export function iconHtml(name: IconName, size = 18, color = "#4a5568"): string {
  if (name === "app") {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><text x="2" y="19" font-size="17" font-weight="700" fill="${color}">m</text><text x="15" y="10" font-size="10" font-weight="700" fill="${color}">3</text></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${PATHS[name]}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
