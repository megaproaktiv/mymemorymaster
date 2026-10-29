package store

import (
	"fmt"

	"mmm/internal/domain"
)

// ListTags returns all tags in the deck.
func (s *Store) ListTags() ([]domain.Tag, error) {
	rows, err := s.db.Query(`SELECT id, name, color, x, y, created_at FROM tag ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list tags: %w", err)
	}
	defer rows.Close()
	var tags []domain.Tag
	for rows.Next() {
		var t domain.Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.X, &t.Y, &t.CreatedAt); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, rows.Err()
}

// TagsForCard returns the tags attached to a card.
func (s *Store) TagsForCard(cardID int64) ([]domain.Tag, error) {
	rows, err := s.db.Query(
		`SELECT t.id, t.name, t.color, t.x, t.y, t.created_at
		 FROM tag t JOIN card_tag ct ON ct.tag_id=t.id
		 WHERE ct.card_id=? ORDER BY t.name`, cardID)
	if err != nil {
		return nil, fmt.Errorf("tags for card: %w", err)
	}
	defer rows.Close()
	var tags []domain.Tag
	for rows.Next() {
		var t domain.Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.X, &t.Y, &t.CreatedAt); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, rows.Err()
}

// maxTagLen is the maximum length of a tag name.
const maxTagLen = 16

// CreateTag inserts a tag (idempotent on name) and returns it. The name is
// trimmed to at most 16 characters.
func (s *Store) CreateTag(name, color string) (domain.Tag, error) {
	name = clampRunes(name, maxTagLen)
	if name == "" {
		return domain.Tag{}, fmt.Errorf("tag name is empty")
	}
	if color == "" {
		color = "#d69e2e"
	}
	ts := now()
	_, err := s.db.Exec(
		`INSERT INTO tag(name, color, created_at) VALUES(?,?,?)
		 ON CONFLICT(name) DO NOTHING`, name, color, ts)
	if err != nil {
		return domain.Tag{}, fmt.Errorf("create tag: %w", err)
	}
	var t domain.Tag
	err = s.db.QueryRow(
		`SELECT id, name, color, x, y, created_at FROM tag WHERE name=?`, name).
		Scan(&t.ID, &t.Name, &t.Color, &t.X, &t.Y, &t.CreatedAt)
	return t, err
}

func clampRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		r = r[:n]
	}
	return string(r)
}

// DeleteTag removes a tag entirely (also detaches it from all cards and removes
// its relations via cascade).
func (s *Store) DeleteTag(id int64) error {
	_, err := s.db.Exec(`DELETE FROM tag WHERE id=?`, id)
	return err
}

// SetTagColor updates a tag's color.
func (s *Store) SetTagColor(id int64, color string) error {
	_, err := s.db.Exec(`UPDATE tag SET color=? WHERE id=?`, color, id)
	return err
}

// UnlinkTags removes a relation between two tags (either direction).
func (s *Store) UnlinkTags(a, b int64) error {
	_, err := s.db.Exec(
		`DELETE FROM tag_relation
		 WHERE (from_tag_id=? AND to_tag_id=?) OR (from_tag_id=? AND to_tag_id=?)`,
		a, b, b, a)
	return err
}

// AttachTag attaches a tag to a card.
func (s *Store) AttachTag(cardID, tagID int64) error {
	_, err := s.db.Exec(
		`INSERT INTO card_tag(card_id, tag_id) VALUES(?,?)
		 ON CONFLICT(card_id, tag_id) DO NOTHING`, cardID, tagID)
	return err
}

// DetachTag removes a tag from a card.
func (s *Store) DetachTag(cardID, tagID int64) error {
	_, err := s.db.Exec(`DELETE FROM card_tag WHERE card_id=? AND tag_id=?`, cardID, tagID)
	return err
}

// MoveTag updates a tag's position in the tag view.
func (s *Store) MoveTag(id int64, x, y float64) error {
	_, err := s.db.Exec(`UPDATE tag SET x=?, y=? WHERE id=?`, x, y, id)
	return err
}

// LinkTags relates two tags in the tag view.
func (s *Store) LinkTags(fromTagID, toTagID int64) error {
	if fromTagID == toTagID {
		return fmt.Errorf("cannot relate a tag to itself")
	}
	_, err := s.db.Exec(
		`INSERT INTO tag_relation(from_tag_id, to_tag_id) VALUES(?,?)
		 ON CONFLICT(from_tag_id, to_tag_id) DO NOTHING`, fromTagID, toTagID)
	return err
}

// TagRelations returns all tag relations.
func (s *Store) TagRelations() ([]domain.TagRelation, error) {
	rows, err := s.db.Query(`SELECT from_tag_id, to_tag_id FROM tag_relation`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var rels []domain.TagRelation
	for rows.Next() {
		var r domain.TagRelation
		if err := rows.Scan(&r.FromTagID, &r.ToTagID); err != nil {
			return nil, err
		}
		rels = append(rels, r)
	}
	return rels, rows.Err()
}
