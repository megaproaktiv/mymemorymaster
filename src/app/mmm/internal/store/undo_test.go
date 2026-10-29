package store

import "testing"

func TestDeleteCardUndo(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	a, _ := s.CreateCard(root.ID, 10, 20)
	s.UpdateCard(a.ID, "Keeper", "important body")
	s.SetCardIcon(a.ID, "idea")
	b, _ := s.CreateCard(root.ID, 300, 20)
	s.CreateLink(a.ID, b.ID)
	tag, _ := s.CreateTag("mytag", "#38a169")
	s.AttachTag(a.ID, tag.ID)
	s.AddCardLink(a.ID, "", "https://example.com", "url")

	snap, err := s.DeleteCardReturningSnapshot(a.ID)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	// Card is gone.
	if _, err := s.Card(a.ID); err == nil {
		t.Fatal("card still present after delete")
	}

	// Undo restores the card with its content, link, tag and external link.
	if err := s.RestoreCardSnapshot(snap); err != nil {
		t.Fatalf("restore: %v", err)
	}
	restored, err := s.Card(a.ID)
	if err != nil {
		t.Fatalf("card missing after restore: %v", err)
	}
	if restored.Heading != "Keeper" || restored.Body != "important body" || restored.Icon != "idea" {
		t.Errorf("restored card = %+v", restored)
	}
	if len(restored.Tags) != 1 || restored.Tags[0].ID != tag.ID {
		t.Errorf("restored tags = %+v", restored.Tags)
	}
	if len(restored.Links) != 1 {
		t.Errorf("restored external links = %d, want 1", len(restored.Links))
	}
	links, _ := s.LinksForPlane(root.ID)
	if len(links) != 1 {
		t.Errorf("restored card links = %d, want 1", len(links))
	}
}

func TestEnsureLight(t *testing.T) {
	// A dark color must be lightened enough for black text (luminance >= 0.75).
	out := EnsureLight("#000000")
	r, g, b, ok := parseHex(out)
	if !ok {
		t.Fatalf("invalid output %q", out)
	}
	lum := (0.299*float64(r) + 0.587*float64(g) + 0.114*float64(b)) / 255.0
	if lum < 0.75 {
		t.Errorf("EnsureLight(#000000)=%s lum=%.2f, want >=0.75", out, lum)
	}
	// An already-light color stays light.
	if EnsureLight("#ffffff") != "#ffffff" {
		t.Errorf("white should stay white, got %s", EnsureLight("#ffffff"))
	}
	// Invalid input falls back to white.
	if EnsureLight("not-a-color") != "#ffffff" {
		t.Errorf("invalid should fall back to white, got %s", EnsureLight("not-a-color"))
	}
}

func TestSetCardDate(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	c, _ := s.CreateCard(root.ID, 0, 0)
	if err := s.SetCardDate(c.ID, "2026-10-29"); err != nil {
		t.Fatalf("set date: %v", err)
	}
	got, _ := s.Card(c.ID)
	if got.Date != "2026-10-29" {
		t.Errorf("date = %q, want 2026-10-29", got.Date)
	}
	// Clearing works.
	s.SetCardDate(c.ID, "")
	got, _ = s.Card(c.ID)
	if got.Date != "" {
		t.Errorf("date not cleared: %q", got.Date)
	}
}

func TestSetCardBgForcesLight(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	c, _ := s.CreateCard(root.ID, 0, 0)
	if err := s.SetCardBg(c.ID, "#101010"); err != nil {
		t.Fatalf("set bg: %v", err)
	}
	got, _ := s.Card(c.ID)
	r, g, b, _ := parseHex(got.BgColor)
	lum := (0.299*float64(r) + 0.587*float64(g) + 0.114*float64(b)) / 255.0
	if lum < 0.75 {
		t.Errorf("stored bg %s too dark (lum %.2f)", got.BgColor, lum)
	}
}

func TestDeleteRootReturnsError(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	cards, _ := s.CardsForPlane(root.ID)
	if _, err := s.DeleteCardReturningSnapshot(cards[0].ID); err == nil {
		t.Error("expected error deleting root card")
	}
}
