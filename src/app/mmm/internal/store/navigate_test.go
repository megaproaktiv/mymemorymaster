package store

import "testing"

func TestSearchCards(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	a, _ := s.CreateCard(root.ID, 0, 0)
	s.UpdateCard(a.ID, "Alpha project", "")
	b, _ := s.CreateCard(root.ID, 300, 0)
	s.UpdateCard(b.ID, "Beta alphabet", "")
	// A nested card on a sub-plane is also searchable (whole deck).
	pa, _ := s.OpenCardPlane(a.ID)
	deep, _ := s.CreateCard(pa.ID, 0, 0)
	s.UpdateCard(deep.ID, "Deep alpha node", "")

	hits, err := s.SearchCards("alpha", 20)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 3 {
		t.Fatalf("hits = %d, want 3 (%v)", len(hits), hits)
	}
	// Prefix match "Alpha project" should rank first.
	if hits[0].Heading != "Alpha project" {
		t.Errorf("first hit = %q, want prefix match first", hits[0].Heading)
	}

	// Empty query returns nothing.
	none, _ := s.SearchCards("   ", 20)
	if len(none) != 0 {
		t.Errorf("empty query returned %d hits", len(none))
	}
}

func TestBuildCardPathThreeLevels(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()

	// Root card already exists; create a card A on root.
	a, _ := s.CreateCard(root.ID, 0, 0)
	// Drill into A -> plane PA; add card B there.
	pa, err := s.OpenCardPlane(a.ID)
	if err != nil {
		t.Fatalf("open A plane: %v", err)
	}
	b, _ := s.CreateCard(pa.ID, 0, 0)
	// Drill into B -> plane PB; add card C there.
	pb, err := s.OpenCardPlane(b.ID)
	if err != nil {
		t.Fatalf("open B plane: %v", err)
	}
	c, _ := s.CreateCard(pb.ID, 0, 0)

	path, err := s.BuildCardPath(c.ID)
	if err != nil {
		t.Fatalf("build path: %v", err)
	}
	if path.TargetCardID != c.ID {
		t.Errorf("target = %d, want %d", path.TargetCardID, c.ID)
	}
	// Steps should be: drill card A, then drill card B (root -> A -> B -> C's plane).
	if len(path.Steps) != 2 {
		t.Fatalf("steps = %d, want 2: %+v", len(path.Steps), path.Steps)
	}
	if path.Steps[0].Kind != "card" || path.Steps[0].ID != a.ID {
		t.Errorf("step0 = %+v, want card %d", path.Steps[0], a.ID)
	}
	if path.Steps[1].Kind != "card" || path.Steps[1].ID != b.ID {
		t.Errorf("step1 = %+v, want card %d", path.Steps[1], b.ID)
	}
}

func TestCardsWithTag(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	a, _ := s.CreateCard(root.ID, 0, 0)
	b, _ := s.CreateCard(root.ID, 300, 0)
	tag, _ := s.CreateTag("shared", "#38a169")
	s.AttachTag(a.ID, tag.ID)
	s.AttachTag(b.ID, tag.ID)

	cards, err := s.CardsWithTag(tag.ID)
	if err != nil {
		t.Fatalf("cards with tag: %v", err)
	}
	if len(cards) != 2 {
		t.Fatalf("cards = %d, want 2", len(cards))
	}
}

func TestBuildCardPathRootCard(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	cards, _ := s.CardsForPlane(root.ID)
	path, err := s.BuildCardPath(cards[0].ID)
	if err != nil {
		t.Fatalf("build path: %v", err)
	}
	if len(path.Steps) != 0 {
		t.Errorf("root card path should have 0 steps, got %d", len(path.Steps))
	}
}
