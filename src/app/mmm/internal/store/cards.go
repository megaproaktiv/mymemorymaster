package store

import (
	"database/sql"
	"fmt"

	"mmm/internal/domain"
)

const cardCols = `id, plane_id, heading, body, x, y, w, h, is_root, markdown, icon, bg_color, date, child_plane_id, created_at, updated_at`

// CardsForPlane returns all cards on a plane, each with its tags.
func (s *Store) CardsForPlane(planeID int64) ([]domain.Card, error) {
	rows, err := s.db.Query(
		`SELECT `+cardCols+` FROM card WHERE plane_id=? ORDER BY id`, planeID)
	if err != nil {
		return nil, fmt.Errorf("query cards: %w", err)
	}
	defer rows.Close()

	var cards []domain.Card
	for rows.Next() {
		c, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range cards {
		tags, err := s.TagsForCard(cards[i].ID)
		if err != nil {
			return nil, err
		}
		cards[i].Tags = tags
		links, err := s.CardLinksForCard(cards[i].ID)
		if err != nil {
			return nil, err
		}
		cards[i].Links = links
	}
	return cards, nil
}

// Card returns a single card by id, with its tags.
func (s *Store) Card(id int64) (domain.Card, error) {
	c, err := scanCardRow(s.db.QueryRow(`SELECT `+cardCols+` FROM card WHERE id=?`, id))
	if err != nil {
		return c, err
	}
	c.Tags, err = s.TagsForCard(id)
	if err != nil {
		return c, err
	}
	c.Links, err = s.CardLinksForCard(id)
	return c, err
}

// CreateCard inserts a new card at (x,y) on the plane and returns it.
func (s *Store) CreateCard(planeID int64, x, y float64) (domain.Card, error) {
	ts := now()
	res, err := s.db.Exec(
		`INSERT INTO card(plane_id, heading, body, x, y, is_root, created_at, updated_at)
		 VALUES(?,?,?,?,?,0,?,?)`,
		planeID, "New card", "", x, y, ts, ts)
	if err != nil {
		return domain.Card{}, fmt.Errorf("create card: %w", err)
	}
	id, _ := res.LastInsertId()
	return s.Card(id)
}

// UpdateCard updates heading and body of a card.
func (s *Store) UpdateCard(id int64, heading, body string) error {
	_, err := s.db.Exec(`UPDATE card SET heading=?, body=?, updated_at=? WHERE id=?`,
		heading, body, now(), id)
	return err
}

// MoveCard updates a card's position.
func (s *Store) MoveCard(id int64, x, y float64) error {
	_, err := s.db.Exec(`UPDATE card SET x=?, y=?, updated_at=? WHERE id=?`,
		x, y, now(), id)
	return err
}

// ResizeCard updates a card's size (clamped to sensible minimums).
func (s *Store) ResizeCard(id int64, w, h float64) error {
	if w < 120 {
		w = 120
	}
	if h < 70 {
		h = 70
	}
	_, err := s.db.Exec(`UPDATE card SET w=?, h=?, updated_at=? WHERE id=?`, w, h, now(), id)
	return err
}

// DeleteCard removes a card. Its links and tag relations cascade. A root card
// cannot be deleted.
func (s *Store) DeleteCard(id int64) error {
	var isRoot bool
	if err := s.db.QueryRow(`SELECT is_root FROM card WHERE id=?`, id).Scan(&isRoot); err != nil {
		if err == sql.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	if isRoot {
		return fmt.Errorf("the root card cannot be deleted")
	}
	_, err := s.db.Exec(`DELETE FROM card WHERE id=?`, id)
	return err
}

// CardSnapshot captures a deleted card and its same-plane links so the delete
// can be undone.
type CardSnapshot struct {
	Card      domain.Card    `json:"card"`
	Links     []domain.Link  `json:"links"`
	TagIDs    []int64        `json:"tagIds"`
	CardLinks []domain.CardLink `json:"cardLinks"`
}

// DeleteCardReturningSnapshot deletes a card and returns a snapshot that can be
// passed to RestoreCardSnapshot to undo the deletion. A root card cannot be
// deleted.
func (s *Store) DeleteCardReturningSnapshot(id int64) (CardSnapshot, error) {
	var snap CardSnapshot
	card, err := s.Card(id)
	if err != nil {
		return snap, err
	}
	if card.IsRoot {
		return snap, fmt.Errorf("the root card cannot be deleted")
	}
	snap.Card = card

	// Capture links on the same plane that touch this card.
	links, _ := s.LinksForPlane(card.PlaneID)
	for _, l := range links {
		if l.FromCardID == id || l.ToCardID == id {
			snap.Links = append(snap.Links, l)
		}
	}
	// Tag associations and external links.
	for _, tg := range card.Tags {
		snap.TagIDs = append(snap.TagIDs, tg.ID)
	}
	snap.CardLinks, _ = s.CardLinksForCard(id)

	if _, err := s.db.Exec(`DELETE FROM card WHERE id=?`, id); err != nil {
		return snap, err
	}
	return snap, nil
}

// RestoreCardSnapshot recreates a previously deleted card (preserving its id)
// along with its links, tag associations and external links.
func (s *Store) RestoreCardSnapshot(snap CardSnapshot) error {
	c := snap.Card
	_, err := s.db.Exec(
		`INSERT INTO card(id, plane_id, heading, body, x, y, w, h, is_root, markdown, icon, bg_color, date, child_plane_id, created_at, updated_at)
		 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		c.ID, c.PlaneID, c.Heading, c.Body, c.X, c.Y, c.W, c.H, boolToInt(c.IsRoot),
		c.Markdown, c.Icon, c.BgColor, c.Date, c.ChildPlaneID, c.CreatedAt, now())
	if err != nil {
		return fmt.Errorf("restore card: %w", err)
	}
	for _, l := range snap.Links {
		// Only restore links whose other endpoint still exists.
		var exists int
		other := l.FromCardID
		if other == c.ID {
			other = l.ToCardID
		}
		s.db.QueryRow(`SELECT COUNT(*) FROM card WHERE id=?`, other).Scan(&exists)
		if exists == 0 {
			continue
		}
		s.db.Exec(
			`INSERT INTO link(id, plane_id, from_card_id, to_card_id, from_anchor, to_anchor, color, width, child_plane_id, created_at)
			 VALUES(?,?,?,?,?,?,?,?,?,?)`,
			l.ID, l.PlaneID, l.FromCardID, l.ToCardID, l.FromAnchor, l.ToAnchor, l.Color, l.Width, l.ChildPlaneID, l.CreatedAt)
	}
	for _, tagID := range snap.TagIDs {
		s.db.Exec(`INSERT INTO card_tag(card_id, tag_id) VALUES(?,?) ON CONFLICT DO NOTHING`, c.ID, tagID)
	}
	for _, cl := range snap.CardLinks {
		s.db.Exec(
			`INSERT INTO card_link(id, card_id, label, target, kind, created_at) VALUES(?,?,?,?,?,?)`,
			cl.ID, cl.CardID, cl.Label, cl.Target, cl.Kind, cl.CreatedAt)
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// CardMarkdown returns the Markdown document of a card.
func (s *Store) CardMarkdown(id int64) (string, error) {
	var md string
	err := s.db.QueryRow(`SELECT markdown FROM card WHERE id=?`, id).Scan(&md)
	if err == sql.ErrNoRows {
		return "", ErrNotFound
	}
	return md, err
}

// SaveCardMarkdown stores the Markdown document of a card.
func (s *Store) SaveCardMarkdown(id int64, markdown string) error {
	_, err := s.db.Exec(`UPDATE card SET markdown=?, updated_at=? WHERE id=?`,
		markdown, now(), id)
	return err
}

// SetCardIcon stores the card's type icon name.
func (s *Store) SetCardIcon(id int64, icon string) error {
	_, err := s.db.Exec(`UPDATE card SET icon=?, updated_at=? WHERE id=?`, icon, now(), id)
	return err
}

// SetCardBg sets the card's background color. The color is forced to be light
// enough that black text stays readable (luminance >= 0.6); otherwise it is
// lightened, and invalid input falls back to white.
func (s *Store) SetCardBg(id int64, color string) error {
	_, err := s.db.Exec(`UPDATE card SET bg_color=?, updated_at=? WHERE id=?`,
		EnsureLight(color), now(), id)
	return err
}

// SetCardDate sets the card's date (YYYY-MM-DD, or empty to clear). Only a
// date is stored, never a time.
func (s *Store) SetCardDate(id int64, date string) error {
	_, err := s.db.Exec(`UPDATE card SET date=?, updated_at=? WHERE id=?`, date, now(), id)
	return err
}

// EnsureLight returns a hex color guaranteed to be light (readable with black
// text). Non-hex input returns white.
func EnsureLight(hex string) string {
	r, g, b, ok := parseHex(hex)
	if !ok {
		return "#ffffff"
	}
	// Relative luminance (perceptual). Raise toward white until light enough.
	lum := func(rr, gg, bb float64) float64 {
		return (0.299*rr + 0.587*gg + 0.114*bb) / 255.0
	}
	rf, gf, bf := float64(r), float64(g), float64(b)
	for lum(rf, gf, bf) < 0.75 {
		rf += (255 - rf) * 0.25
		gf += (255 - gf) * 0.25
		bf += (255 - bf) * 0.25
	}
	return fmt.Sprintf("#%02x%02x%02x", int(rf+0.5), int(gf+0.5), int(bf+0.5))
}

func parseHex(hex string) (int, int, int, bool) {
	if len(hex) == 4 && hex[0] == '#' {
		// #rgb -> #rrggbb
		hex = fmt.Sprintf("#%c%c%c%c%c%c", hex[1], hex[1], hex[2], hex[2], hex[3], hex[3])
	}
	if len(hex) != 7 || hex[0] != '#' {
		return 0, 0, 0, false
	}
	var r, g, b int
	if _, err := fmt.Sscanf(hex[1:], "%02x%02x%02x", &r, &g, &b); err != nil {
		return 0, 0, 0, false
	}
	return r, g, b, true
}

// DuplicateCardTo creates a copy of a card on the given plane at (x,y) and
// returns the new card. Copies the card's content, tag associations, external
// links and attachments. (Connections between cards and the card's own child
// plane are not copied here — those are handled by the group duplicate.)
func (s *Store) DuplicateCardTo(cardID, planeID int64, x, y float64) (domain.Card, error) {
	src, err := s.Card(cardID)
	if err != nil {
		return domain.Card{}, err
	}
	ts := now()
	res, err := s.db.Exec(
		`INSERT INTO card(plane_id, heading, body, x, y, w, h, is_root, markdown, icon, bg_color, date, created_at, updated_at)
		 VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,
		planeID, src.Heading, src.Body, x, y, src.W, src.H, src.Markdown, src.Icon, src.BgColor, src.Date, ts, ts)
	if err != nil {
		return domain.Card{}, fmt.Errorf("duplicate card: %w", err)
	}
	id, _ := res.LastInsertId()

	// Copy tag associations (tags themselves are shared).
	for _, tg := range src.Tags {
		s.db.Exec(
			`INSERT INTO card_tag(card_id, tag_id) VALUES(?,?) ON CONFLICT DO NOTHING`,
			id, tg.ID)
	}
	// Copy external links (URL / file / folder).
	cardLinks, _ := s.CardLinksForCard(cardID)
	for _, cl := range cardLinks {
		s.db.Exec(
			`INSERT INTO card_link(card_id, label, target, kind, created_at) VALUES(?,?,?,?,?)`,
			id, cl.Label, cl.Target, cl.Kind, ts)
	}
	// Copy attachments (blob data).
	rows, err := s.db.Query(
		`SELECT filename, mime, data FROM attachment WHERE card_id=? ORDER BY id`, cardID)
	if err == nil {
		type att struct {
			filename, mime string
			data           []byte
		}
		var atts []att
		for rows.Next() {
			var a att
			if err := rows.Scan(&a.filename, &a.mime, &a.data); err == nil {
				atts = append(atts, a)
			}
		}
		rows.Close()
		for _, a := range atts {
			s.db.Exec(
				`INSERT INTO attachment(card_id, filename, mime, data, created_at) VALUES(?,?,?,?,?)`,
				id, a.filename, a.mime, a.data, ts)
		}
	}

	return s.Card(id)
}

// OpenCardPlane returns the child plane of a card, creating it lazily on first
// drill-in. The child plane starts empty with its own root card so the user
// can immediately add cards.
func (s *Store) OpenCardPlane(cardID int64) (domain.Plane, error) {
	var childID sql.NullInt64
	if err := s.db.QueryRow(`SELECT child_plane_id FROM card WHERE id=?`, cardID).Scan(&childID); err != nil {
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
		`INSERT INTO plane(kind, view_state, created_at, updated_at) VALUES(?,?,?,?)`,
		domain.PlaneCard, "", ts, ts)
	if err != nil {
		return domain.Plane{}, fmt.Errorf("create card plane: %w", err)
	}
	planeID, _ := res.LastInsertId()
	if _, err := s.db.Exec(
		`INSERT INTO plane_owner_card(plane_id, card_id) VALUES(?,?)`, planeID, cardID); err != nil {
		return domain.Plane{}, err
	}
	if _, err := s.db.Exec(`UPDATE card SET child_plane_id=? WHERE id=?`, planeID, cardID); err != nil {
		return domain.Plane{}, err
	}
	return s.Plane(planeID)
}

func scanCard(rows *sql.Rows) (domain.Card, error) {
	var c domain.Card
	err := rows.Scan(&c.ID, &c.PlaneID, &c.Heading, &c.Body, &c.X, &c.Y, &c.W, &c.H,
		&c.IsRoot, &c.Markdown, &c.Icon, &c.BgColor, &c.Date, &c.ChildPlaneID, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return c, fmt.Errorf("scan card: %w", err)
	}
	return c, nil
}

func scanCardRow(row *sql.Row) (domain.Card, error) {
	var c domain.Card
	err := row.Scan(&c.ID, &c.PlaneID, &c.Heading, &c.Body, &c.X, &c.Y, &c.W, &c.H,
		&c.IsRoot, &c.Markdown, &c.Icon, &c.BgColor, &c.Date, &c.ChildPlaneID, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return c, ErrNotFound
	}
	if err != nil {
		return c, fmt.Errorf("scan card: %w", err)
	}
	return c, nil
}
