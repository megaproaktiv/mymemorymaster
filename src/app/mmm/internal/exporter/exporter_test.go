package exporter

import (
	"strings"
	"testing"

	"mmm/internal/domain"
)

// fakeReader serves pre-built planes for the renderer tests.
type fakeReader struct {
	planes map[int64]domain.PlaneContent
	atts   map[int64][]domain.Attachment
}

func (f *fakeReader) PlaneContent(planeID int64) (domain.PlaneContent, error) {
	return f.planes[planeID], nil
}

func (f *fakeReader) ListAttachments(cardID int64) ([]domain.Attachment, error) {
	return f.atts[cardID], nil
}

func ptr(v int64) *int64 { return &v }

func TestRenderSingleLevel(t *testing.T) {
	child := int64(2)
	r := &fakeReader{
		planes: map[int64]domain.PlaneContent{
			1: {
				Plane: domain.Plane{ID: 1},
				Cards: []domain.Card{
					{ID: 10, Heading: "Root", IsRoot: true, Body: "root body"},
					{
						ID:           11,
						Heading:      "Child card",
						Body:         "a body",
						Icon:         "project",
						Date:         "2026-01-01",
						Tags:         []domain.Tag{{Name: "urgent"}},
						Links:        []domain.CardLink{{Label: "docs", Target: "https://x", Kind: "url"}},
						ChildPlaneID: &child,
					},
				},
				Links: []domain.Link{{ID: 5, FromCardID: 10, ToCardID: 11}},
			},
			2: {
				Plane: domain.Plane{ID: 2},
				Cards: []domain.Card{{ID: 20, Heading: "Nested", IsRoot: true}},
			},
		},
		atts: map[int64][]domain.Attachment{
			11: {{Filename: "spec.pdf"}},
		},
	}

	// Non-recursive: child plane content must NOT appear.
	md, err := Render(r, 1, Options{Title: "Level A", Recursive: false})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	for _, want := range []string{
		"# Level A",
		"## Root",
		"## Child card",
		"type: project",
		"date: 2026-01-01",
		"`urgent`",
		"root body",
		"[docs](https://x)",
		"Attachments: spec.pdf",
		"Root → Child card",
	} {
		if !strings.Contains(md, want) {
			t.Errorf("non-recursive export missing %q\n---\n%s", want, md)
		}
	}
	if strings.Contains(md, "Nested") {
		t.Errorf("non-recursive export unexpectedly included child plane:\n%s", md)
	}

	// Recursive: child plane content must appear.
	mdR, err := Render(r, 1, Options{Title: "Level A", Recursive: true})
	if err != nil {
		t.Fatalf("render recursive: %v", err)
	}
	if !strings.Contains(mdR, "Nested") {
		t.Errorf("recursive export missing child plane content:\n%s", mdR)
	}
	if !strings.Contains(mdR, "recursive") {
		t.Errorf("recursive export missing recursive marker:\n%s", mdR)
	}
}

func TestRenderHandlesCycle(t *testing.T) {
	// Plane 1 has a card whose child plane is plane 1 again (pathological).
	self := int64(1)
	r := &fakeReader{
		planes: map[int64]domain.PlaneContent{
			1: {
				Plane: domain.Plane{ID: 1},
				Cards: []domain.Card{{ID: 10, Heading: "Loop", IsRoot: true, ChildPlaneID: &self}},
			},
		},
	}
	// Should terminate (visited-set) rather than recurse forever.
	if _, err := Render(r, 1, Options{Title: "Loopy", Recursive: true}); err != nil {
		t.Fatalf("render cycle: %v", err)
	}
}
