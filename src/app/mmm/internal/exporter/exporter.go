// Package exporter renders a plane (and optionally the planes nested beneath
// it) to a single Markdown document. It reads through the store but never
// mutates it: the recursive walk follows the child_plane_id already stored on
// cards and links, so planes that were never drilled into are simply skipped.
package exporter

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"mmm/internal/domain"
)

// Reader is the subset of the store the exporter needs. Keeping it as an
// interface makes the renderer easy to unit-test with a fake.
type Reader interface {
	PlaneContent(planeID int64) (domain.PlaneContent, error)
	ListAttachments(cardID int64) ([]domain.Attachment, error)
}

// Options control what a single export produces.
type Options struct {
	// Title is shown as the top-level H1 (usually the current level's label).
	Title string
	// Recursive follows child planes of cards and links.
	Recursive bool
}

// Render builds the Markdown document for the plane identified by planeID.
func Render(r Reader, planeID int64, opts Options) (string, error) {
	var b strings.Builder

	title := strings.TrimSpace(opts.Title)
	if title == "" {
		title = "My Memory Master export"
	}
	fmt.Fprintf(&b, "# %s\n\n", escapeInline(title))
	fmt.Fprintf(&b, "_Exported %s", time.Now().Format("2006-01-02 15:04"))
	if opts.Recursive {
		b.WriteString(" · recursive")
	}
	b.WriteString("_\n\n")

	visited := map[int64]bool{}
	if err := renderPlane(&b, r, planeID, 2, opts.Recursive, visited, nil); err != nil {
		return "", err
	}
	return b.String(), nil
}

// renderPlane writes one plane at the given heading level. When recursive, it
// descends into the child planes of cards and links. trail carries the heading
// path so nested sections stay oriented; visited prevents cycles.
func renderPlane(
	b *strings.Builder,
	r Reader,
	planeID int64,
	level int,
	recursive bool,
	visited map[int64]bool,
	trail []string,
) error {
	if visited[planeID] {
		return nil
	}
	visited[planeID] = true

	pc, err := r.PlaneContent(planeID)
	if err != nil {
		return fmt.Errorf("read plane %d: %w", planeID, err)
	}

	// Stable order: root first, then by id (creation order).
	cards := append([]domain.Card(nil), pc.Cards...)
	sort.SliceStable(cards, func(i, j int) bool {
		if cards[i].IsRoot != cards[j].IsRoot {
			return cards[i].IsRoot
		}
		return cards[i].ID < cards[j].ID
	})

	headingByID := map[int64]string{}
	for _, c := range cards {
		headingByID[c.ID] = cardHeading(c)
	}

	// Each card is a section.
	for _, c := range cards {
		renderCard(b, r, c, level)

		if recursive && c.ChildPlaneID != nil {
			childTrail := append(trail, cardHeading(c))
			fmt.Fprintf(b, "%s %s\n\n", hashes(min(level+1, 6)), "↳ "+escapeInline(pathLabel(childTrail)))
			if err := renderPlane(b, r, *c.ChildPlaneID, min(level+2, 6), recursive, visited, childTrail); err != nil {
				return err
			}
		}
	}

	// Connections between cards on this plane.
	if len(pc.Links) > 0 {
		fmt.Fprintf(b, "%s Connections\n\n", hashes(min(level, 6)))
		links := append([]domain.Link(nil), pc.Links...)
		sort.SliceStable(links, func(i, j int) bool { return links[i].ID < links[j].ID })
		for _, l := range links {
			from := headingByID[l.FromCardID]
			to := headingByID[l.ToCardID]
			if from == "" {
				from = fmt.Sprintf("card %d", l.FromCardID)
			}
			if to == "" {
				to = fmt.Sprintf("card %d", l.ToCardID)
			}
			fmt.Fprintf(b, "- %s → %s\n", escapeInline(from), escapeInline(to))
		}
		b.WriteString("\n")

		if recursive {
			for _, l := range links {
				if l.ChildPlaneID == nil {
					continue
				}
				label := fmt.Sprintf("%s → %s", headingByID[l.FromCardID], headingByID[l.ToCardID])
				fmt.Fprintf(b, "%s ↳ %s\n\n", hashes(min(level+1, 6)), escapeInline(label))
				if err := renderPlane(b, r, *l.ChildPlaneID, min(level+2, 6), recursive, visited, append(trail, label)); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// renderCard writes a single card as a Markdown section.
func renderCard(b *strings.Builder, r Reader, c domain.Card, level int) {
	fmt.Fprintf(b, "%s %s\n\n", hashes(min(level, 6)), escapeInline(cardHeading(c)))

	// Metadata line: icon, date, tags.
	var meta []string
	if c.Icon != "" && c.Icon != "note" {
		meta = append(meta, "type: "+c.Icon)
	}
	if c.Date != "" {
		meta = append(meta, "date: "+c.Date)
	}
	if len(c.Tags) > 0 {
		names := make([]string, 0, len(c.Tags))
		for _, tg := range c.Tags {
			names = append(names, "`"+tg.Name+"`")
		}
		meta = append(meta, "tags: "+strings.Join(names, " "))
	}
	if len(meta) > 0 {
		fmt.Fprintf(b, "_%s_\n\n", strings.Join(meta, " · "))
	}

	// Short body text shown on the card face.
	if body := strings.TrimSpace(c.Body); body != "" {
		b.WriteString(body)
		b.WriteString("\n\n")
	}

	// Full Markdown document owned by the card (if any), kept verbatim.
	if doc := strings.TrimSpace(c.Markdown); doc != "" {
		b.WriteString(doc)
		if !strings.HasSuffix(doc, "\n") {
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}

	// External links (URLs / files).
	if len(c.Links) > 0 {
		for _, lnk := range c.Links {
			label := lnk.Label
			if label == "" {
				label = lnk.Target
			}
			fmt.Fprintf(b, "- [%s](%s)\n", escapeInline(label), lnk.Target)
		}
		b.WriteString("\n")
	}

	// Attachments (names only; blobs stay in the deck).
	if atts, err := r.ListAttachments(c.ID); err == nil && len(atts) > 0 {
		b.WriteString("Attachments: ")
		names := make([]string, 0, len(atts))
		for _, a := range atts {
			names = append(names, a.Filename)
		}
		b.WriteString(escapeInline(strings.Join(names, ", ")))
		b.WriteString("\n\n")
	}
}

func cardHeading(c domain.Card) string {
	h := strings.TrimSpace(c.Heading)
	if h == "" {
		return "Untitled"
	}
	return h
}

func pathLabel(trail []string) string {
	return strings.Join(trail, " / ")
}

// hashes returns n '#' characters for a Markdown heading of that level.
func hashes(n int) string {
	if n < 1 {
		n = 1
	}
	return strings.Repeat("#", n)
}

// escapeInline neutralises characters that would break a single-line heading
// or label. Body/markdown content is emitted verbatim and is not escaped.
func escapeInline(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	return strings.TrimSpace(s)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
