package store

import (
	"mmm/internal/domain"
)

// GroupSnapshot captures several deleted cards plus the links among them, for a
// single multi-card undo.
type GroupSnapshot struct {
	Cards []CardSnapshot `json:"cards"`
	// Links between two cards that were both in the deleted set (captured once).
	Links []domain.Link `json:"links"`
}

// DeleteCardsReturningSnapshot deletes several cards (skipping the root card)
// and returns a snapshot for undo. Links where both endpoints are in the set
// are captured once so they can be restored.
func (s *Store) DeleteCardsReturningSnapshot(ids []int64) (GroupSnapshot, error) {
	var snap GroupSnapshot
	idset := make(map[int64]bool, len(ids))
	for _, id := range ids {
		idset[id] = true
	}

	// Collect internal links once (from the planes of the cards).
	seenLink := make(map[int64]bool)
	for _, id := range ids {
		card, err := s.Card(id)
		if err != nil || card.IsRoot {
			continue
		}
		links, _ := s.LinksForPlane(card.PlaneID)
		for _, l := range links {
			if idset[l.FromCardID] && idset[l.ToCardID] && !seenLink[l.ID] {
				seenLink[l.ID] = true
				snap.Links = append(snap.Links, l)
			}
		}
	}

	// Capture and delete each card (reuse single-card snapshot, but drop its
	// link list to avoid double-restoring internal links).
	for _, id := range ids {
		card, err := s.Card(id)
		if err != nil || card.IsRoot {
			continue
		}
		cs := CardSnapshot{Card: card}
		for _, tg := range card.Tags {
			cs.TagIDs = append(cs.TagIDs, tg.ID)
		}
		cs.CardLinks, _ = s.CardLinksForCard(id)
		if _, err := s.db.Exec(`DELETE FROM card WHERE id=?`, id); err != nil {
			return snap, err
		}
		snap.Cards = append(snap.Cards, cs)
	}
	return snap, nil
}

// RestoreGroupSnapshot recreates a previously deleted group of cards and the
// internal links among them (preserving ids).
func (s *Store) RestoreGroupSnapshot(snap GroupSnapshot) error {
	for _, cs := range snap.Cards {
		// Restore the card without its (per-card) link list; internal links are
		// restored below from snap.Links.
		noLinks := cs
		noLinks.Links = nil
		if err := s.RestoreCardSnapshot(noLinks); err != nil {
			return err
		}
	}
	// Restore internal links (both endpoints now exist again).
	for _, l := range snap.Links {
		s.db.Exec(
			`INSERT INTO link(id, plane_id, from_card_id, to_card_id, from_anchor, to_anchor, color, width, child_plane_id, created_at)
			 VALUES(?,?,?,?,?,?,?,?,?,?)`,
			l.ID, l.PlaneID, l.FromCardID, l.ToCardID, l.FromAnchor, l.ToAnchor, l.Color, l.Width, l.ChildPlaneID, l.CreatedAt)
	}
	return nil
}

// DuplicateGroupResult reports the new cards created by a group duplicate.
type DuplicateGroupResult struct {
	Cards []domain.Card `json:"cards"`
}

// DuplicateCardsTo copies several cards onto a plane, offset by (dx,dy), and
// recreates the links whose both endpoints are in the set. Returns the new
// cards. Tags/attachments/child planes are not copied.
func (s *Store) DuplicateCardsTo(ids []int64, planeID int64, dx, dy float64) (DuplicateGroupResult, error) {
	var out DuplicateGroupResult
	idset := make(map[int64]bool, len(ids))
	for _, id := range ids {
		idset[id] = true
	}
	// Map old card id -> new card id.
	idmap := make(map[int64]int64)

	for _, id := range ids {
		src, err := s.Card(id)
		if err != nil {
			continue
		}
		nc, err := s.DuplicateCardTo(id, planeID, src.X+dx, src.Y+dy)
		if err != nil {
			return out, err
		}
		idmap[id] = nc.ID
		out.Cards = append(out.Cards, nc)
	}

	// Recreate internal links on the target plane.
	seen := make(map[int64]bool)
	for _, id := range ids {
		src, err := s.Card(id)
		if err != nil {
			continue
		}
		links, _ := s.LinksForPlane(src.PlaneID)
		for _, l := range links {
			if seen[l.ID] || !idset[l.FromCardID] || !idset[l.ToCardID] {
				continue
			}
			seen[l.ID] = true
			nf, nt := idmap[l.FromCardID], idmap[l.ToCardID]
			if nf == 0 || nt == 0 {
				continue
			}
			s.db.Exec(
				`INSERT INTO link(plane_id, from_card_id, to_card_id, from_anchor, to_anchor, color, width, created_at)
				 VALUES(?,?,?,?,?,?,?,?)`,
				planeID, nf, nt, l.FromAnchor, l.ToAnchor, l.Color, l.Width, now())
		}
	}
	return out, nil
}
