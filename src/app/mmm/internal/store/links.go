package store

import (
	"database/sql"
	"fmt"

	"mmm/internal/domain"
)

const linkCols = `id, plane_id, from_card_id, to_card_id, from_anchor, to_anchor, color, width, child_plane_id, created_at`

func scanLink(row interface{ Scan(...any) error }) (domain.Link, error) {
	var l domain.Link
	err := row.Scan(&l.ID, &l.PlaneID, &l.FromCardID, &l.ToCardID,
		&l.FromAnchor, &l.ToAnchor, &l.Color, &l.Width, &l.ChildPlaneID, &l.CreatedAt)
	return l, err
}

// SetLinkStyle updates a link's color and stroke width. Width is clamped to
// one of the allowed values 1, 4, 8.
func (s *Store) SetLinkStyle(id int64, color string, width int) error {
	switch width {
	case 1, 4, 8:
	default:
		width = 2
	}
	_, err := s.db.Exec(`UPDATE link SET color=?, width=? WHERE id=?`, color, width, id)
	return err
}

// LinksForPlane returns all links on a plane.
func (s *Store) LinksForPlane(planeID int64) ([]domain.Link, error) {
	rows, err := s.db.Query(`SELECT `+linkCols+` FROM link WHERE plane_id=? ORDER BY id`, planeID)
	if err != nil {
		return nil, fmt.Errorf("query links: %w", err)
	}
	defer rows.Close()

	var links []domain.Link
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, fmt.Errorf("scan link: %w", err)
		}
		links = append(links, l)
	}
	return links, rows.Err()
}

func validAnchor(a string) string {
	switch a {
	case "center", "left", "right", "top", "bottom":
		return a
	default:
		return "center"
	}
}

// CreateLink connects two cards on the same plane with center anchors.
func (s *Store) CreateLink(fromCardID, toCardID int64) (domain.Link, error) {
	return s.CreateLinkAnchored(fromCardID, toCardID, "center", "center")
}

// CreateLinkAnchored connects two cards recording the anchor side on each card.
// Duplicate links (same pair, either direction) are rejected.
func (s *Store) CreateLinkAnchored(fromCardID, toCardID int64, fromAnchor, toAnchor string) (domain.Link, error) {
	if fromCardID == toCardID {
		return domain.Link{}, fmt.Errorf("cannot link a card to itself")
	}
	var fromPlane, toPlane int64
	if err := s.db.QueryRow(`SELECT plane_id FROM card WHERE id=?`, fromCardID).Scan(&fromPlane); err != nil {
		return domain.Link{}, fmt.Errorf("from card: %w", err)
	}
	if err := s.db.QueryRow(`SELECT plane_id FROM card WHERE id=?`, toCardID).Scan(&toPlane); err != nil {
		return domain.Link{}, fmt.Errorf("to card: %w", err)
	}
	if fromPlane != toPlane {
		return domain.Link{}, fmt.Errorf("cards are on different planes")
	}

	var existing int
	s.db.QueryRow(
		`SELECT COUNT(*) FROM link
		 WHERE (from_card_id=? AND to_card_id=?) OR (from_card_id=? AND to_card_id=?)`,
		fromCardID, toCardID, toCardID, fromCardID).Scan(&existing)
	if existing > 0 {
		return domain.Link{}, fmt.Errorf("these cards are already linked")
	}

	ts := now()
	res, err := s.db.Exec(
		`INSERT INTO link(plane_id, from_card_id, to_card_id, from_anchor, to_anchor, created_at)
		 VALUES(?,?,?,?,?,?)`,
		fromPlane, fromCardID, toCardID, validAnchor(fromAnchor), validAnchor(toAnchor), ts)
	if err != nil {
		return domain.Link{}, fmt.Errorf("create link: %w", err)
	}
	id, _ := res.LastInsertId()
	return scanLink(s.db.QueryRow(`SELECT `+linkCols+` FROM link WHERE id=?`, id))
}

// DeleteLink removes a link. Its child plane (if any) is left untouched.
func (s *Store) DeleteLink(id int64) error {
	_, err := s.db.Exec(`DELETE FROM link WHERE id=?`, id)
	return err
}

// OpenLinkPlane returns the child plane of a link, creating it lazily on first
// drill-in.
func (s *Store) OpenLinkPlane(linkID int64) (domain.Plane, error) {
	var childID sql.NullInt64
	if err := s.db.QueryRow(`SELECT child_plane_id FROM link WHERE id=?`, linkID).Scan(&childID); err != nil {
		if err == sql.ErrNoRows {
			return domain.Plane{}, ErrNotFound
		}
		return domain.Plane{}, err
	}
	if childID.Valid {
		return s.Plane(childID.Int64)
	}
	ts := now()
	res, err := s.db.Exec(
		`INSERT INTO plane(kind, owner_link_id, view_state, created_at, updated_at)
		 VALUES(?,?,?,?,?)`, domain.PlaneLink, linkID, "", ts, ts)
	if err != nil {
		return domain.Plane{}, fmt.Errorf("create link plane: %w", err)
	}
	planeID, _ := res.LastInsertId()
	if _, err := s.db.Exec(`UPDATE link SET child_plane_id=? WHERE id=?`, planeID, linkID); err != nil {
		return domain.Plane{}, err
	}
	return s.Plane(planeID)
}
