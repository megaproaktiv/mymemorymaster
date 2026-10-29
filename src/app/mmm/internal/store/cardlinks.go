package store

import (
	"fmt"
	"strings"

	"mmm/internal/domain"
)

// CardLinksForCard returns the external links attached to a card.
func (s *Store) CardLinksForCard(cardID int64) ([]domain.CardLink, error) {
	rows, err := s.db.Query(
		`SELECT id, card_id, label, target, kind, created_at
		 FROM card_link WHERE card_id=? ORDER BY id`, cardID)
	if err != nil {
		return nil, fmt.Errorf("query card links: %w", err)
	}
	defer rows.Close()
	var out []domain.CardLink
	for rows.Next() {
		var l domain.CardLink
		if err := rows.Scan(&l.ID, &l.CardID, &l.Label, &l.Target, &l.Kind, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// AddCardLink attaches an external link (URL or file path) to a card.
func (s *Store) AddCardLink(cardID int64, label, target, kind string) (domain.CardLink, error) {
	if target == "" {
		return domain.CardLink{}, fmt.Errorf("link target is empty")
	}
	if kind != "file" {
		kind = "url"
	}
	label = shortLabel(label, target, kind)
	ts := now()
	res, err := s.db.Exec(
		`INSERT INTO card_link(card_id, label, target, kind, created_at) VALUES(?,?,?,?,?)`,
		cardID, label, target, kind, ts)
	if err != nil {
		return domain.CardLink{}, fmt.Errorf("add card link: %w", err)
	}
	id, _ := res.LastInsertId()
	return domain.CardLink{
		ID: id, CardID: cardID, Label: label, Target: target, Kind: kind, CreatedAt: ts,
	}, nil
}

// shortLabel returns a display label of at most 16 characters. A user-supplied
// label is clamped; an empty label is derived from the tail of the target
// (file name for paths, host+path tail for URLs).
func shortLabel(label, target, kind string) string {
	s := strings.TrimSpace(label)
	if s == "" {
		s = target
		if kind == "file" {
			s = strings.TrimRight(s, `/\`)
			if i := strings.LastIndexAny(s, `/\`); i >= 0 {
				s = s[i+1:]
			}
		} else {
			s = strings.TrimPrefix(s, "https://")
			s = strings.TrimPrefix(s, "http://")
		}
	}
	r := []rune(s)
	if len(r) > 16 {
		// Keep the most specific (trailing) part.
		r = append([]rune("…"), r[len(r)-15:]...)
	}
	return string(r)
}

// SetCardLinkLabel updates a link's short label (clamped to 16 characters).
func (s *Store) SetCardLinkLabel(id int64, label string) error {
	link, err := s.CardLink(id)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE card_link SET label=? WHERE id=?`,
		shortLabel(label, link.Target, link.Kind), id)
	return err
}

// CardLink returns a single external link by id.
func (s *Store) CardLink(id int64) (domain.CardLink, error) {
	var l domain.CardLink
	err := s.db.QueryRow(
		`SELECT id, card_id, label, target, kind, created_at FROM card_link WHERE id=?`, id).
		Scan(&l.ID, &l.CardID, &l.Label, &l.Target, &l.Kind, &l.CreatedAt)
	if err != nil {
		return l, ErrNotFound
	}
	return l, nil
}

// DeleteCardLink removes an external link.
func (s *Store) DeleteCardLink(id int64) error {
	_, err := s.db.Exec(`DELETE FROM card_link WHERE id=?`, id)
	return err
}
