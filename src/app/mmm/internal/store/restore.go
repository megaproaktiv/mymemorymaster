package store

import (
	"database/sql"
	"fmt"
)

// RestoreFromFile replaces all deck data in the live database with the contents
// of the SQLite file at backupPath, using the already-open connection. This
// avoids swapping the database file underneath an open WAL connection (which
// does not take effect and can be reverted by the exit-time checkpoint).
//
// The copy runs in a single transaction: every known table is cleared and
// repopulated from the attached backup. Because it reuses the live connection,
// the running application sees the restored data immediately and the WAL stays
// consistent.
func (s *Store) RestoreFromFile(backupPath string) error {
	// Validate the backup is a usable SQLite database first.
	if err := validateSQLite(backupPath); err != nil {
		return fmt.Errorf("backup is not a valid database: %w", err)
	}

	if _, err := s.db.Exec(`ATTACH DATABASE ? AS backup`, backupPath); err != nil {
		return fmt.Errorf("attach backup: %w", err)
	}
	defer s.db.Exec(`DETACH DATABASE backup`)

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin restore tx: %w", err)
	}
	// Ensure a failure rolls everything back.
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if _, err := tx.Exec(`PRAGMA foreign_keys=OFF`); err != nil {
		return fmt.Errorf("disable fk: %w", err)
	}

	// Tables to restore, children before parents on delete; insert order is
	// handled with foreign keys off so order does not matter for inserts.
	tables := []string{
		"meta",
		"plane",
		"card",
		"plane_owner_card",
		"link",
		"card_link",
		"tag",
		"card_tag",
		"tag_relation",
		"attachment",
	}

	// Clear live tables (reverse dependency order is safe with FKs off).
	for i := len(tables) - 1; i >= 0; i-- {
		if _, err := tx.Exec(`DELETE FROM main.` + tables[i]); err != nil {
			return fmt.Errorf("clear %s: %w", tables[i], err)
		}
	}
	// Copy from backup only for tables that exist in the backup.
	for _, tbl := range tables {
		if !tableExists(tx, "backup", tbl) {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO main.` + tbl + ` SELECT * FROM backup.` + tbl); err != nil {
			return fmt.Errorf("copy %s: %w", tbl, err)
		}
	}

	if _, err := tx.Exec(`PRAGMA foreign_keys=ON`); err != nil {
		return fmt.Errorf("enable fk: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit restore: %w", err)
	}
	committed = true

	// Make sure the deck still has a root (in case the backup was empty).
	if err := s.ensureRoot(); err != nil {
		return err
	}
	return nil
}

// validateSQLite opens path read-only and runs an integrity check.
func validateSQLite(path string) error {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	defer db.Close()
	var ok string
	if err := db.QueryRow(`PRAGMA integrity_check`).Scan(&ok); err != nil {
		return err
	}
	if ok != "ok" {
		return fmt.Errorf("integrity_check = %q", ok)
	}
	return nil
}

// tableExists reports whether a table exists in the given schema (main/backup).
func tableExists(tx *sql.Tx, schema, table string) bool {
	var name string
	err := tx.QueryRow(
		`SELECT name FROM `+schema+`.sqlite_master WHERE type='table' AND name=?`, table).
		Scan(&name)
	return err == nil
}
