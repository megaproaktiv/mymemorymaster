package store

import (
	"bytes"
	"path/filepath"
	"testing"
)

func TestAttachmentRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	root, err := s.RootPlane()
	if err != nil {
		t.Fatalf("root plane: %v", err)
	}
	cards, err := s.CardsForPlane(root.ID)
	if err != nil || len(cards) == 0 {
		t.Fatalf("cards: %v (n=%d)", err, len(cards))
	}
	cardID := cards[0].ID

	payload := []byte("hello attachment \x00\x01\x02 binary")
	att, err := s.AddAttachment(cardID, "note.bin", "application/octet-stream", payload)
	if err != nil {
		t.Fatalf("add attachment: %v", err)
	}
	if att.Size != int64(len(payload)) {
		t.Errorf("size = %d, want %d", att.Size, len(payload))
	}

	list, err := s.ListAttachments(cardID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].Filename != "note.bin" {
		t.Fatalf("list = %+v", list)
	}

	name, mime, data, err := s.AttachmentData(att.ID)
	if err != nil {
		t.Fatalf("data: %v", err)
	}
	if name != "note.bin" || mime != "application/octet-stream" || !bytes.Equal(data, payload) {
		t.Errorf("round-trip mismatch: name=%q mime=%q data=%q", name, mime, data)
	}
}

func TestCreateLinkRejectsDuplicatesAndSelf(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer s.Close()

	root, _ := s.RootPlane()
	a, _ := s.CreateCard(root.ID, 0, 0)
	b, _ := s.CreateCard(root.ID, 300, 0)

	if _, err := s.CreateLink(a.ID, a.ID); err == nil {
		t.Error("expected self-link to be rejected")
	}
	if _, err := s.CreateLink(a.ID, b.ID); err != nil {
		t.Fatalf("first link: %v", err)
	}
	if _, err := s.CreateLink(b.ID, a.ID); err == nil {
		t.Error("expected duplicate (reverse) link to be rejected")
	}
}
