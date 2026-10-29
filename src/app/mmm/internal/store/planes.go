package store

import (
	"database/sql"
	"fmt"

	"mmm/internal/domain"
)

// RootPlane returns the deck's root plane.
func (s *Store) RootPlane() (domain.Plane, error) {
	return s.scanPlane(s.db.QueryRow(
		`SELECT id, kind, owner_link_id, view_state, created_at, updated_at
		 FROM plane WHERE kind=? LIMIT 1`, domain.PlaneRoot))
}

// Plane returns a plane by id.
func (s *Store) Plane(id int64) (domain.Plane, error) {
	return s.scanPlane(s.db.QueryRow(
		`SELECT id, kind, owner_link_id, view_state, created_at, updated_at
		 FROM plane WHERE id=?`, id))
}

func (s *Store) scanPlane(row *sql.Row) (domain.Plane, error) {
	var p domain.Plane
	err := row.Scan(&p.ID, &p.Kind, &p.OwnerLinkID, &p.ViewState, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return p, ErrNotFound
	}
	if err != nil {
		return p, fmt.Errorf("scan plane: %w", err)
	}
	return p, nil
}

// SaveViewState stores the pan/zoom JSON for a plane.
func (s *Store) SaveViewState(planeID int64, viewState string) error {
	_, err := s.db.Exec(`UPDATE plane SET view_state=?, updated_at=? WHERE id=?`,
		viewState, now(), planeID)
	return err
}

// PlaneContent loads the plane with all its cards (incl. tags) and links.
func (s *Store) PlaneContent(planeID int64) (domain.PlaneContent, error) {
	var out domain.PlaneContent
	p, err := s.Plane(planeID)
	if err != nil {
		return out, err
	}
	out.Plane = p
	if out.Cards, err = s.CardsForPlane(planeID); err != nil {
		return out, err
	}
	if out.Links, err = s.LinksForPlane(planeID); err != nil {
		return out, err
	}
	return out, nil
}
