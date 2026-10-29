package store

import "testing"

func TestTagNameClampedTo16(t *testing.T) {
	s := openTest(t)
	tag, err := s.CreateTag("this-name-is-way-too-long", "#38a169")
	if err != nil {
		t.Fatalf("create tag: %v", err)
	}
	if len([]rune(tag.Name)) != 16 {
		t.Errorf("name len = %d, want 16 (%q)", len([]rune(tag.Name)), tag.Name)
	}
	if tag.Color != "#38a169" {
		t.Errorf("color = %q", tag.Color)
	}
}

func TestTagLinkUnlinkDelete(t *testing.T) {
	s := openTest(t)
	a, _ := s.CreateTag("alpha", "#e53e3e")
	b, _ := s.CreateTag("beta", "#3182ce")

	if err := s.LinkTags(a.ID, b.ID); err != nil {
		t.Fatalf("link: %v", err)
	}
	rels, _ := s.TagRelations()
	if len(rels) != 1 {
		t.Fatalf("relations = %d, want 1", len(rels))
	}

	// Unlink in reverse direction works.
	if err := s.UnlinkTags(b.ID, a.ID); err != nil {
		t.Fatalf("unlink: %v", err)
	}
	rels, _ = s.TagRelations()
	if len(rels) != 0 {
		t.Fatalf("relations after unlink = %d, want 0", len(rels))
	}

	// Delete removes the tag.
	if err := s.DeleteTag(a.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	all, _ := s.ListTags()
	for _, tg := range all {
		if tg.ID == a.ID {
			t.Error("deleted tag still present")
		}
	}
}

func TestSetTagColor(t *testing.T) {
	s := openTest(t)
	tag, _ := s.CreateTag("gamma", "#e53e3e")
	if err := s.SetTagColor(tag.ID, "#805ad5"); err != nil {
		t.Fatalf("set color: %v", err)
	}
	all, _ := s.ListTags()
	for _, tg := range all {
		if tg.ID == tag.ID && tg.Color != "#805ad5" {
			t.Errorf("color = %q, want #805ad5", tg.Color)
		}
	}
}
