package store

import (
	"fmt"
	"strings"

	"mmm/internal/domain"
)

// PathStep is one hop on the way from the root plane down to a target card.
// Kind is "card" (drill into a card) or "link" (drill into a link). ID is the
// card id or link id to open to descend to the next plane.
type PathStep struct {
	Kind string `json:"kind"` // "card" | "link"
	ID   int64  `json:"id"`
}

// CardPath returns the sequence of drill-in steps from the root plane to the
// plane that contains the given card, plus the target card id. Replaying the
// steps (OpenCardPlane / OpenLinkPlane) reaches the card's plane; then select
// TargetCardID. This is the backbone of in-app deep links.
type CardPath struct {
	Steps        []PathStep `json:"steps"`
	TargetCardID int64      `json:"targetCardId"`
}

// BuildCardPath walks up from a card to the root, then reverses, producing a
// replayable descent path.
func (s *Store) BuildCardPath(cardID int64) (CardPath, error) {
	out := CardPath{TargetCardID: cardID}

	// Current plane = the plane the card sits on.
	var planeID int64
	if err := s.db.QueryRow(`SELECT plane_id FROM card WHERE id=?`, cardID).Scan(&planeID); err != nil {
		return out, ErrNotFound
	}

	var steps []PathStep
	guard := 0
	for {
		guard++
		if guard > 1000 {
			return out, fmt.Errorf("path too deep (cycle?)")
		}
		p, err := s.Plane(planeID)
		if err != nil {
			return out, err
		}
		switch p.Kind {
		case domain.PlaneRoot:
			// Reverse steps: we collected them bottom-up.
			for i, j := 0, len(steps)-1; i < j; i, j = i+1, j-1 {
				steps[i], steps[j] = steps[j], steps[i]
			}
			out.Steps = steps
			return out, nil
		case domain.PlaneCard:
			// Owner card of this plane.
			var ownerCard int64
			if err := s.db.QueryRow(
				`SELECT card_id FROM plane_owner_card WHERE plane_id=?`, planeID).Scan(&ownerCard); err != nil {
				return out, fmt.Errorf("owner card for plane %d: %w", planeID, err)
			}
			steps = append(steps, PathStep{Kind: "card", ID: ownerCard})
			if err := s.db.QueryRow(`SELECT plane_id FROM card WHERE id=?`, ownerCard).Scan(&planeID); err != nil {
				return out, err
			}
		case domain.PlaneLink:
			if p.OwnerLinkID == nil {
				return out, fmt.Errorf("link plane %d has no owner link", planeID)
			}
			linkID := *p.OwnerLinkID
			steps = append(steps, PathStep{Kind: "link", ID: linkID})
			if err := s.db.QueryRow(`SELECT plane_id FROM link WHERE id=?`, linkID).Scan(&planeID); err != nil {
				return out, err
			}
		default:
			return out, fmt.Errorf("unexpected plane kind %q", p.Kind)
		}
	}
}

// CardsWithTag returns all cards that carry the given tag OR any tag that is
// hierarchically below it. Tag relations are directed parent -> child
// (from_tag_id = parent, to_tag_id = child), so the descendants of a tag are
// reached by following edges from the tag downward (transitive closure).
func (s *Store) CardsWithTag(tagID int64) ([]domain.Card, error) {
	// Collect the tag and all its descendants.
	tagIDs := s.descendantTags(tagID)

	seen := make(map[int64]bool)
	var cards []domain.Card
	for _, tid := range tagIDs {
		rows, err := s.db.Query(
			`SELECT c.id FROM card c JOIN card_tag ct ON ct.card_id=c.id
			 WHERE ct.tag_id=? ORDER BY c.heading`, tid)
		if err != nil {
			return nil, fmt.Errorf("cards with tag: %w", err)
		}
		var ids []int64
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			ids = append(ids, id)
		}
		rows.Close()
		for _, id := range ids {
			if seen[id] {
				continue
			}
			seen[id] = true
			if c, err := s.Card(id); err == nil {
				cards = append(cards, c)
			}
		}
	}
	return cards, nil
}

// descendantTags returns the tag id plus all tags reachable downward via
// directed relations (parent from_tag_id -> child to_tag_id).
func (s *Store) descendantTags(tagID int64) []int64 {
	visited := map[int64]bool{tagID: true}
	queue := []int64{tagID}
	var out []int64
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		out = append(out, cur)
		rows, err := s.db.Query(`SELECT to_tag_id FROM tag_relation WHERE from_tag_id=?`, cur)
		if err != nil {
			continue
		}
		var children []int64
		for rows.Next() {
			var child int64
			if err := rows.Scan(&child); err == nil {
				children = append(children, child)
			}
		}
		rows.Close()
		for _, child := range children {
			if !visited[child] {
				visited[child] = true
				queue = append(queue, child)
			}
		}
	}
	return out
}

// SearchHit is a lightweight search result for the title search bar.
type SearchHit struct {
	ID      int64  `json:"id"`
	Heading string `json:"heading"`
	PlaneID int64  `json:"planeId"`
}

// SearchCards returns cards whose heading contains the query (case-insensitive)
// across the whole deck, ordered so that prefix matches come first, then by
// heading. The limit caps the number of hits (0 = default 20).
func (s *Store) SearchCards(query string, limit int) ([]SearchHit, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 20
	}
	like := "%" + escapeLike(q) + "%"
	prefix := escapeLike(q) + "%"
	rows, err := s.db.Query(
		`SELECT id, heading, plane_id FROM card
		 WHERE heading LIKE ? ESCAPE '\'
		 ORDER BY (CASE WHEN heading LIKE ? ESCAPE '\' THEN 0 ELSE 1 END),
		          LENGTH(heading), heading
		 LIMIT ?`, like, prefix, limit)
	if err != nil {
		return nil, fmt.Errorf("search cards: %w", err)
	}
	defer rows.Close()
	var hits []SearchHit
	for rows.Next() {
		var h SearchHit
		if err := rows.Scan(&h.ID, &h.Heading, &h.PlaneID); err != nil {
			return nil, err
		}
		hits = append(hits, h)
	}
	return hits, rows.Err()
}

// escapeLike escapes LIKE wildcards in a user query.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "%", `\%`)
	s = strings.ReplaceAll(s, "_", `\_`)
	return s
}
