package store

import (
	"path/filepath"
	"testing"

	"mmm/internal/domain"
)

func TestLinkPersistsAfterReload(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	root, _ := s.RootPlane()
	a, _ := s.CreateCard(root.ID, 0, 0)
	b, _ := s.CreateCard(root.ID, 300, 0)
	if _, err := s.CreateLink(a.ID, b.ID); err != nil {
		t.Fatalf("create link: %v", err)
	}

	// Simulate navigating away and back: reload the plane content fresh.
	content, err := s.PlaneContent(root.ID)
	if err != nil {
		t.Fatalf("plane content: %v", err)
	}
	if len(content.Links) != 1 {
		t.Fatalf("links after reload = %d, want 1", len(content.Links))
	}
}

func TestOpenCardPlaneIsLazyAndStable(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	root, _ := s.RootPlane()
	cards, _ := s.CardsForPlane(root.ID)
	cardID := cards[0].ID

	// Before drilling in, the card has no child plane.
	c, _ := s.Card(cardID)
	if c.ChildPlaneID != nil {
		t.Fatalf("expected no child plane initially, got %v", *c.ChildPlaneID)
	}

	// First drill-in creates a card plane.
	p1, err := s.OpenCardPlane(cardID)
	if err != nil {
		t.Fatalf("open card plane: %v", err)
	}
	if p1.Kind != domain.PlaneCard {
		t.Errorf("kind = %q, want %q", p1.Kind, domain.PlaneCard)
	}

	// Second drill-in returns the same plane (stable id).
	p2, err := s.OpenCardPlane(cardID)
	if err != nil {
		t.Fatalf("open card plane 2: %v", err)
	}
	if p1.ID != p2.ID {
		t.Errorf("child plane id changed: %d vs %d", p1.ID, p2.ID)
	}

	// The card now reports its child plane.
	c, _ = s.Card(cardID)
	if c.ChildPlaneID == nil || *c.ChildPlaneID != p1.ID {
		t.Errorf("card child plane = %v, want %d", c.ChildPlaneID, p1.ID)
	}

	// Cards can be added to the new plane.
	if _, err := s.CreateCard(p1.ID, 10, 10); err != nil {
		t.Fatalf("create card on child plane: %v", err)
	}
	sub, _ := s.CardsForPlane(p1.ID)
	if len(sub) != 1 {
		t.Errorf("child plane cards = %d, want 1", len(sub))
	}
}
