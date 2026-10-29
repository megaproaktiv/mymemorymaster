package backup

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func newTestDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mmm.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := db.Exec(`CREATE TABLE t(id INTEGER); INSERT INTO t VALUES(1);`); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return db, path
}

func TestBackupTitleRoundTrip(t *testing.T) {
	db, dbPath := newTestDB(t)
	defer db.Close()
	dir := t.TempDir()
	m, err := New(db, dbPath, dir)
	if err != nil {
		t.Fatalf("new: %v", err)
	}

	info, err := m.Now("Milestone one")
	if err != nil {
		t.Fatalf("now: %v", err)
	}
	if info.Title != "Milestone one" {
		t.Errorf("title = %q", info.Title)
	}

	list, err := m.List()
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 || list[0].Title != "Milestone one" {
		t.Fatalf("list title = %+v", list)
	}
}

func TestBackupTitleTruncatedTo32(t *testing.T) {
	db, dbPath := newTestDB(t)
	defer db.Close()
	m, _ := New(db, dbPath, t.TempDir())

	long := strings.Repeat("x", 50)
	info, err := m.Now(long)
	if err != nil {
		t.Fatalf("now: %v", err)
	}
	if len([]rune(info.Title)) != 32 {
		t.Errorf("title length = %d, want 32", len([]rune(info.Title)))
	}
}
