// Package store is the SQLite persistence layer for mmm. One database holds
// exactly one memory deck (one root plane). The schema is created idempotently
// on open. Uses the pure-Go driver modernc.org/sqlite (no CGo).
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"mmm/internal/domain"

	_ "modernc.org/sqlite"
)

// Store wraps the SQLite database.
type Store struct {
	db   *sql.DB
	path string
}

// Open opens (or creates) the database at path, applies the schema and ensures
// the deck has a root plane with a root card.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	s := &Store{db: db, path: path}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.ensureRoot(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

// Close closes the underlying database.
func (s *Store) Close() error { return s.db.Close() }

// Path returns the database file path.
func (s *Store) Path() string { return s.path }

// DB exposes the raw handle (used by the backup package for VACUUM INTO).
func (s *Store) DB() *sql.DB { return s.db }

func now() string { return time.Now().UTC().Format(time.RFC3339) }

func (s *Store) migrate() error {
	const schema = `
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plane (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL,
    owner_link_id INTEGER,
    view_state    TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS card (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    plane_id       INTEGER NOT NULL REFERENCES plane(id) ON DELETE CASCADE,
    heading        TEXT NOT NULL DEFAULT '',
    body           TEXT NOT NULL DEFAULT '',
    x              REAL NOT NULL DEFAULT 0,
    y              REAL NOT NULL DEFAULT 0,
    w              REAL NOT NULL DEFAULT 200,
    h              REAL NOT NULL DEFAULT 96,
    is_root        INTEGER NOT NULL DEFAULT 0,
    markdown       TEXT NOT NULL DEFAULT '',
    icon           TEXT NOT NULL DEFAULT 'note',
    bg_color       TEXT NOT NULL DEFAULT '#ffffff',
    date           TEXT NOT NULL DEFAULT '',
    child_plane_id INTEGER REFERENCES plane(id),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plane_owner_card (
    plane_id INTEGER PRIMARY KEY REFERENCES plane(id) ON DELETE CASCADE,
    card_id  INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS link (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    plane_id       INTEGER NOT NULL REFERENCES plane(id) ON DELETE CASCADE,
    from_card_id   INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
    to_card_id     INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
    from_anchor    TEXT NOT NULL DEFAULT 'center',
    to_anchor      TEXT NOT NULL DEFAULT 'center',
    color          TEXT NOT NULL DEFAULT '',
    width          INTEGER NOT NULL DEFAULT 2,
    child_plane_id INTEGER REFERENCES plane(id),
    created_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS card_link (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id    INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
    label      TEXT NOT NULL DEFAULT '',
    target     TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'url',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tag (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT NOT NULL DEFAULT '#f4d35e',
    x          REAL NOT NULL DEFAULT 0,
    y          REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS card_tag (
    card_id INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, tag_id)
);
CREATE TABLE IF NOT EXISTS tag_relation (
    from_tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    to_tag_id   INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    PRIMARY KEY (from_tag_id, to_tag_id)
);
CREATE TABLE IF NOT EXISTS attachment (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id    INTEGER NOT NULL REFERENCES card(id) ON DELETE CASCADE,
    filename   TEXT NOT NULL,
    mime       TEXT NOT NULL DEFAULT '',
    data       BLOB,
    created_at TEXT NOT NULL
);
`
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	// Additive column migrations for databases created by older versions.
	if err := s.ensureColumn("card", "child_plane_id", "INTEGER"); err != nil {
		return err
	}
	if err := s.ensureColumn("card", "icon", "TEXT NOT NULL DEFAULT 'note'"); err != nil {
		return err
	}
	if err := s.ensureColumn("link", "from_anchor", "TEXT NOT NULL DEFAULT 'center'"); err != nil {
		return err
	}
	if err := s.ensureColumn("link", "to_anchor", "TEXT NOT NULL DEFAULT 'center'"); err != nil {
		return err
	}
	if err := s.ensureColumn("card", "w", "REAL NOT NULL DEFAULT 200"); err != nil {
		return err
	}
	if err := s.ensureColumn("card", "h", "REAL NOT NULL DEFAULT 96"); err != nil {
		return err
	}
	if err := s.ensureColumn("link", "color", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := s.ensureColumn("link", "width", "INTEGER NOT NULL DEFAULT 2"); err != nil {
		return err
	}
	if err := s.ensureColumn("card", "bg_color", "TEXT NOT NULL DEFAULT '#ffffff'"); err != nil {
		return err
	}
	if err := s.ensureColumn("card", "date", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	// Record schema version for future additive migrations.
	if _, err := s.db.Exec(
		`INSERT INTO meta(key,value) VALUES('schema_version','7')
		 ON CONFLICT(key) DO UPDATE SET value='7'`); err != nil {
		return fmt.Errorf("migrate meta: %w", err)
	}
	return nil
}

// ensureColumn adds a column to a table if it does not already exist (additive
// migration via PRAGMA table_info).
func (s *Store) ensureColumn(table, column, typ string) error {
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return fmt.Errorf("table_info %s: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt any
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == column {
			return nil // already present
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = s.db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + typ)
	if err != nil {
		return fmt.Errorf("add column %s.%s: %w", table, column, err)
	}
	return nil
}

// ensureRoot makes sure there is a root plane with a root card (one deck).
func (s *Store) ensureRoot() error {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM plane WHERE kind=?`, domain.PlaneRoot).Scan(&count); err != nil {
		return fmt.Errorf("count root plane: %w", err)
	}
	if count > 0 {
		return nil
	}
	ts := now()
	res, err := s.db.Exec(
		`INSERT INTO plane(kind, view_state, created_at, updated_at) VALUES(?,?,?,?)`,
		domain.PlaneRoot, "", ts, ts)
	if err != nil {
		return fmt.Errorf("create root plane: %w", err)
	}
	planeID, _ := res.LastInsertId()
	_, err = s.db.Exec(
		`INSERT INTO card(plane_id, heading, body, x, y, is_root, created_at, updated_at)
		 VALUES(?,?,?,?,?,1,?,?)`,
		planeID, "My Memory Master", "The root of your deck. Press + to add a card.",
		0.0, 0.0, ts, ts)
	if err != nil {
		return fmt.Errorf("create root card: %w", err)
	}
	return nil
}

// ErrNotFound is returned when a requested row does not exist.
var ErrNotFound = errors.New("not found")
