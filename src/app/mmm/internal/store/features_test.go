package store

import (
	"path/filepath"
	"testing"
)

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestAnchoredLink(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	a, _ := s.CreateCard(root.ID, 0, 0)
	b, _ := s.CreateCard(root.ID, 300, 0)

	l, err := s.CreateLinkAnchored(a.ID, b.ID, "right", "left")
	if err != nil {
		t.Fatalf("anchored link: %v", err)
	}
	if l.FromAnchor != "right" || l.ToAnchor != "left" {
		t.Errorf("anchors = %q/%q, want right/left", l.FromAnchor, l.ToAnchor)
	}

	// Invalid anchor falls back to center.
	c, _ := s.CreateCard(root.ID, 0, 300)
	l2, _ := s.CreateLinkAnchored(a.ID, c.ID, "bogus", "")
	if l2.FromAnchor != "center" || l2.ToAnchor != "center" {
		t.Errorf("fallback anchors = %q/%q, want center/center", l2.FromAnchor, l2.ToAnchor)
	}
}

func TestCardLinkShortLabel(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	cards, _ := s.CardsForPlane(root.ID)
	id := cards[0].ID

	// Empty label derives from the file name, clamped to 16 chars.
	l1, _ := s.AddCardLink(id, "", "/Users/me/docs/a-very-long-file-name.pdf", "file")
	if len([]rune(l1.Label)) > 16 {
		t.Errorf("file label too long: %q (%d)", l1.Label, len([]rune(l1.Label)))
	}

	// Empty label for a URL drops the scheme and keeps the tail.
	l2, _ := s.AddCardLink(id, "", "https://example.com/some/really/long/path", "url")
	if len([]rune(l2.Label)) > 16 {
		t.Errorf("url label too long: %q", l2.Label)
	}

	// Explicit long label is clamped.
	l3, _ := s.AddCardLink(id, "this label is far too long to keep", "https://x.io", "url")
	if len([]rune(l3.Label)) > 16 {
		t.Errorf("explicit label too long: %q", l3.Label)
	}

	// SetCardLinkLabel also clamps.
	if err := s.SetCardLinkLabel(l3.ID, "anotherverylonglabelhere"); err != nil {
		t.Fatalf("set label: %v", err)
	}
	got, _ := s.CardLink(l3.ID)
	if len([]rune(got.Label)) > 16 {
		t.Errorf("updated label too long: %q", got.Label)
	}
}

func TestCardLinkCRUD(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	cards, _ := s.CardsForPlane(root.ID)
	id := cards[0].ID

	l, err := s.AddCardLink(id, "Docs", "https://example.com", "url")
	if err != nil {
		t.Fatalf("add card link: %v", err)
	}
	list, _ := s.CardLinksForCard(id)
	if len(list) != 1 || list[0].Target != "https://example.com" {
		t.Fatalf("list = %+v", list)
	}
	got, err := s.CardLink(l.ID)
	if err != nil || got.Label != "Docs" {
		t.Fatalf("card link = %+v err=%v", got, err)
	}
	if err := s.DeleteCardLink(l.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	list, _ = s.CardLinksForCard(id)
	if len(list) != 0 {
		t.Errorf("after delete, list = %d", len(list))
	}
}

func TestDuplicateCardCopiesTagsLinksAttachments(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	src, _ := s.CreateCard(root.ID, 0, 0)
	tag, _ := s.CreateTag("mytag", "#38a169")
	s.AttachTag(src.ID, tag.ID)
	s.AddCardLink(src.ID, "Docs", "https://example.com", "url")
	s.AddAttachment(src.ID, "note.txt", "text/plain", []byte("hello"))

	dup, err := s.DuplicateCardTo(src.ID, root.ID, 400, 50)
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	// Tag association copied.
	if len(dup.Tags) != 1 || dup.Tags[0].ID != tag.ID {
		t.Errorf("tags = %+v, want the shared tag", dup.Tags)
	}
	// External link copied (new row, same target).
	links, _ := s.CardLinksForCard(dup.ID)
	if len(links) != 1 || links[0].Target != "https://example.com" {
		t.Errorf("card links = %+v, want 1 copy", links)
	}
	if links[0].ID == 0 {
		t.Error("copied link should have its own id")
	}
	// Attachment copied (new row, same bytes).
	atts, _ := s.ListAttachments(dup.ID)
	if len(atts) != 1 || atts[0].Filename != "note.txt" {
		t.Fatalf("attachments = %+v, want 1 copy", atts)
	}
	_, _, data, _ := s.AttachmentData(atts[0].ID)
	if string(data) != "hello" {
		t.Errorf("attachment data = %q, want hello", data)
	}
}

func TestDuplicateCard(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	src, _ := s.CreateCard(root.ID, 0, 0)
	s.UpdateCard(src.ID, "Original", "body text")
	s.SetCardIcon(src.ID, "idea")

	dup, err := s.DuplicateCardTo(src.ID, root.ID, 400, 50)
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	if dup.ID == src.ID {
		t.Fatal("duplicate has same id")
	}
	if dup.Heading != "Original" || dup.Body != "body text" || dup.Icon != "idea" {
		t.Errorf("duplicate = %+v", dup)
	}
	if dup.X != 400 || dup.Y != 50 {
		t.Errorf("duplicate position = %v,%v", dup.X, dup.Y)
	}
}

func TestResizeCardClampsMinimums(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	c, _ := s.CreateCard(root.ID, 0, 0)

	if err := s.ResizeCard(c.ID, 300, 200); err != nil {
		t.Fatalf("resize: %v", err)
	}
	got, _ := s.Card(c.ID)
	if got.W != 300 || got.H != 200 {
		t.Errorf("size = %vx%v, want 300x200", got.W, got.H)
	}

	// Below minimums are clamped.
	s.ResizeCard(c.ID, 10, 10)
	got, _ = s.Card(c.ID)
	if got.W != 120 || got.H != 70 {
		t.Errorf("clamped size = %vx%v, want 120x70", got.W, got.H)
	}
}

func TestSetLinkStyle(t *testing.T) {
	s := openTest(t)
	root, _ := s.RootPlane()
	a, _ := s.CreateCard(root.ID, 0, 0)
	b, _ := s.CreateCard(root.ID, 300, 0)
	l, _ := s.CreateLink(a.ID, b.ID)

	if err := s.SetLinkStyle(l.ID, "#3182ce", 4); err != nil {
		t.Fatalf("set style: %v", err)
	}
	links, _ := s.LinksForPlane(root.ID)
	if len(links) != 1 || links[0].Color != "#3182ce" || links[0].Width != 4 {
		t.Fatalf("link style = %+v", links)
	}

	// Invalid width falls back to 2.
	s.SetLinkStyle(l.ID, "", 99)
	links, _ = s.LinksForPlane(root.ID)
	if links[0].Width != 2 {
		t.Errorf("width = %d, want 2", links[0].Width)
	}
}
