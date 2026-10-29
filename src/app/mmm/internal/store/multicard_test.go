package store

import "testing"

func TestDuplicateCardsWithInternalLinks(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	a, _ := s.CreateCard(root.ID, 0, 0)
	b, _ := s.CreateCard(root.ID, 300, 0)
	c, _ := s.CreateCard(root.ID, 600, 0)
	s.CreateLink(a.ID, b.ID) // internal to {a,b}
	s.CreateLink(b.ID, c.ID) // c not in selection

	res, err := s.DuplicateCardsTo([]int64{a.ID, b.ID}, root.ID, 40, 40)
	if err != nil {
		t.Fatalf("duplicate group: %v", err)
	}
	if len(res.Cards) != 2 {
		t.Fatalf("duplicated cards = %d, want 2", len(res.Cards))
	}
	// Links on the plane: original 2 + 1 copied internal link (a'->b').
	links, _ := s.LinksForPlane(root.ID)
	if len(links) != 3 {
		t.Errorf("links = %d, want 3 (2 original + 1 copied)", len(links))
	}
}

func TestDeleteCardsAndRestore(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	a, _ := s.CreateCard(root.ID, 0, 0)
	b, _ := s.CreateCard(root.ID, 300, 0)
	s.CreateLink(a.ID, b.ID)

	snap, err := s.DeleteCardsReturningSnapshot([]int64{a.ID, b.ID})
	if err != nil {
		t.Fatalf("delete group: %v", err)
	}
	if len(snap.Cards) != 2 || len(snap.Links) != 1 {
		t.Fatalf("snapshot = %d cards, %d links; want 2,1", len(snap.Cards), len(snap.Links))
	}
	// Both gone.
	cards, _ := s.CardsForPlane(root.ID)
	// Only the root card remains.
	if len(cards) != 1 {
		t.Fatalf("after delete, plane has %d cards, want 1 (root)", len(cards))
	}

	if err := s.RestoreGroupSnapshot(snap); err != nil {
		t.Fatalf("restore group: %v", err)
	}
	cards, _ = s.CardsForPlane(root.ID)
	if len(cards) != 3 {
		t.Errorf("after restore, plane has %d cards, want 3", len(cards))
	}
	links, _ := s.LinksForPlane(root.ID)
	if len(links) != 1 {
		t.Errorf("after restore, links = %d, want 1", len(links))
	}
}

func TestCardsWithTagHierarchical(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	// Tools (parent) -> Efficiency (child).
	tools, _ := s.CreateTag("Tools", "#38a169")
	eff, _ := s.CreateTag("Efficiency", "#3182ce")
	s.LinkTags(tools.ID, eff.ID) // from=parent Tools, to=child Efficiency

	toolCard, _ := s.CreateCard(root.ID, 0, 0)
	effCard, _ := s.CreateCard(root.ID, 300, 0)
	s.AttachTag(toolCard.ID, tools.ID)
	s.AttachTag(effCard.ID, eff.ID)

	// Efficiency: only its own cards.
	effCards, _ := s.CardsWithTag(eff.ID)
	if len(effCards) != 1 {
		t.Errorf("Efficiency cards = %d, want 1", len(effCards))
	}
	// Tools: own cards + descendant (Efficiency) cards.
	toolCards, _ := s.CardsWithTag(tools.ID)
	if len(toolCards) != 2 {
		t.Errorf("Tools cards = %d, want 2 (Tools + Efficiency)", len(toolCards))
	}
}
