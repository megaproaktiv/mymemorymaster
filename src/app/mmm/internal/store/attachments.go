package store

import (
	"database/sql"
	"fmt"

	"mmm/internal/domain"
)

// ListAttachments returns the attachments of a card (metadata only).
func (s *Store) ListAttachments(cardID int64) ([]domain.Attachment, error) {
	rows, err := s.db.Query(
		`SELECT id, card_id, filename, mime, COALESCE(LENGTH(data),0), created_at
		 FROM attachment WHERE card_id=? ORDER BY id`, cardID)
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}
	defer rows.Close()
	var out []domain.Attachment
	for rows.Next() {
		var a domain.Attachment
		if err := rows.Scan(&a.ID, &a.CardID, &a.Filename, &a.Mime, &a.Size, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// AddAttachment stores a file blob against a card and returns its metadata.
func (s *Store) AddAttachment(cardID int64, filename, mime string, data []byte) (domain.Attachment, error) {
	ts := now()
	res, err := s.db.Exec(
		`INSERT INTO attachment(card_id, filename, mime, data, created_at) VALUES(?,?,?,?,?)`,
		cardID, filename, mime, data, ts)
	if err != nil {
		return domain.Attachment{}, fmt.Errorf("add attachment: %w", err)
	}
	id, _ := res.LastInsertId()
	return domain.Attachment{
		ID: id, CardID: cardID, Filename: filename, Mime: mime,
		Size: int64(len(data)), CreatedAt: ts,
	}, nil
}

// AttachmentData returns the filename, mime and raw bytes of an attachment.
func (s *Store) AttachmentData(id int64) (string, string, []byte, error) {
	var filename, mime string
	var data []byte
	err := s.db.QueryRow(`SELECT filename, mime, data FROM attachment WHERE id=?`, id).
		Scan(&filename, &mime, &data)
	if err == sql.ErrNoRows {
		return "", "", nil, ErrNotFound
	}
	return filename, mime, data, err
}

// DeleteAttachment removes an attachment.
func (s *Store) DeleteAttachment(id int64) error {
	_, err := s.db.Exec(`DELETE FROM attachment WHERE id=?`, id)
	return err
}

// Meta returns a meta value by key, or empty string if absent.
func (s *Store) Meta(key string) (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT value FROM meta WHERE key=?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}

// SetMeta upserts a meta value.
func (s *Store) SetMeta(key, value string) error {
	_, err := s.db.Exec(
		`INSERT INTO meta(key,value) VALUES(?,?)
		 ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}
