// Package backup creates and restores zipped, timestamped snapshots of the
// mmm SQLite database. Snapshots are produced with VACUUM INTO so the copy is
// consistent even while the app is running.
package backup

import (
	"archive/zip"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Info describes one backup archive.
type Info struct {
	Path      string `json:"path"`
	Filename  string `json:"filename"`
	Title     string `json:"title"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"createdAt"`
}

// maxTitleLen is the maximum length of a user-supplied backup title.
const maxTitleLen = 32

// Manager owns the backup directory and the live DB handle.
type Manager struct {
	db     *sql.DB
	dbPath string
	dir    string
}

// New creates a backup manager. dir is created if missing.
func New(db *sql.DB, dbPath, dir string) (*Manager, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create backup dir: %w", err)
	}
	return &Manager{db: db, dbPath: dbPath, dir: dir}, nil
}

// Dir returns the backup directory.
func (m *Manager) Dir() string { return m.dir }

// SetDir changes the backup directory (created if missing).
func (m *Manager) SetDir(dir string) error {
	if dir == "" {
		return fmt.Errorf("empty backup directory")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create backup dir: %w", err)
	}
	m.dir = dir
	return nil
}

// Now writes a timestamped zipped snapshot with an optional title (max 32
// characters) and returns its info.
func (m *Manager) Now(title string) (Info, error) {
	title = sanitizeTitle(title)
	ts := time.Now()
	stamp := ts.Format("20060102-150405")

	// 1. Consistent copy of the DB via VACUUM INTO into a temp file.
	tmpDB := filepath.Join(m.dir, "mmm-"+stamp+".db.tmp")
	if _, err := m.db.Exec(`VACUUM INTO ?`, tmpDB); err != nil {
		return Info{}, fmt.Errorf("vacuum into: %w", err)
	}
	defer os.Remove(tmpDB)

	// 2. Zip it, embedding the title as a sidecar entry.
	zipPath := filepath.Join(m.dir, "mmm-"+stamp+".zip")
	if err := writeBackupZip(tmpDB, title, zipPath); err != nil {
		return Info{}, err
	}
	fi, err := os.Stat(zipPath)
	if err != nil {
		return Info{}, err
	}
	return Info{
		Path:      zipPath,
		Filename:  filepath.Base(zipPath),
		Title:     title,
		Size:      fi.Size(),
		CreatedAt: ts.UTC().Format(time.RFC3339),
	}, nil
}

// sanitizeTitle trims a title to a single line of at most maxTitleLen runes.
func sanitizeTitle(title string) string {
	title = strings.TrimSpace(strings.ReplaceAll(title, "\n", " "))
	r := []rune(title)
	if len(r) > maxTitleLen {
		r = r[:maxTitleLen]
	}
	return string(r)
}

// List returns all backups, newest first, including any stored title.
func (m *Manager) List() ([]Info, error) {
	entries, err := os.ReadDir(m.dir)
	if err != nil {
		return nil, err
	}
	var out []Info
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".zip") {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		path := filepath.Join(m.dir, e.Name())
		out = append(out, Info{
			Path:      path,
			Filename:  e.Name(),
			Title:     readTitle(path),
			Size:      fi.Size(),
			CreatedAt: fi.ModTime().UTC().Format(time.RFC3339),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Filename > out[j].Filename })
	return out, nil
}

// ExtractForRestore extracts the backup's mmm.db to a temp file and returns its
// path. The caller is responsible for applying it (via the live store) and then
// removing the temp file. Separated from Restore so the restore can be applied
// through the open database connection instead of swapping files.
func (m *Manager) ExtractForRestore(zipPath string) (string, error) {
	extracted, err := extractDB(zipPath, m.dir)
	if err != nil {
		return "", err
	}
	if err := validateDB(extracted); err != nil {
		os.Remove(extracted)
		return "", fmt.Errorf("backup is not a valid database: %w", err)
	}
	return extracted, nil
}

// Restore extracts mmm.db from the given zip over the live database. The live
// DB is backed up to a .pre-restore file first so a failed restore leaves the
// original intact.
func (m *Manager) Restore(zipPath string) error {
	extracted, err := extractDB(zipPath, m.dir)
	if err != nil {
		return err
	}
	defer os.Remove(extracted)

	// Validate the extracted file is a usable SQLite DB before swapping.
	if err := validateDB(extracted); err != nil {
		return fmt.Errorf("backup is not a valid database: %w", err)
	}

	safety := m.dbPath + ".pre-restore"
	if _, err := os.Stat(m.dbPath); err == nil {
		if err := copyFile(m.dbPath, safety); err != nil {
			return fmt.Errorf("safety copy: %w", err)
		}
	}
	if err := copyFile(extracted, m.dbPath); err != nil {
		// Attempt rollback.
		if _, statErr := os.Stat(safety); statErr == nil {
			_ = copyFile(safety, m.dbPath)
		}
		return fmt.Errorf("restore copy: %w", err)
	}
	return nil
}

func validateDB(path string) error {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	defer db.Close()
	var ok string
	return db.QueryRow(`PRAGMA integrity_check`).Scan(&ok)
}

// writeBackupZip writes the database and an optional title sidecar into a zip.
func writeBackupZip(dbPath, title, zipPath string) error {
	out, err := os.Create(zipPath)
	if err != nil {
		return fmt.Errorf("create zip: %w", err)
	}
	defer out.Close()

	zw := zip.NewWriter(out)
	defer zw.Close()

	// mmm.db
	w, err := zw.Create("mmm.db")
	if err != nil {
		return err
	}
	in, err := os.Open(dbPath)
	if err != nil {
		return err
	}
	defer in.Close()
	if _, err := io.Copy(w, in); err != nil {
		return err
	}

	// title.txt (optional)
	if title != "" {
		tw, err := zw.Create("title.txt")
		if err != nil {
			return err
		}
		if _, err := tw.Write([]byte(title)); err != nil {
			return err
		}
	}
	return nil
}

// readTitle returns the title stored in a backup zip, or "" if none.
func readTitle(zipPath string) string {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return ""
	}
	defer zr.Close()
	for _, f := range zr.File {
		if filepath.Base(f.Name) != "title.txt" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return ""
		}
		defer rc.Close()
		data, err := io.ReadAll(io.LimitReader(rc, 256))
		if err != nil {
			return ""
		}
		return sanitizeTitle(string(data))
	}
	return ""
}

func extractDB(zipPath, dir string) (string, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", fmt.Errorf("open zip: %w", err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if filepath.Base(f.Name) != "mmm.db" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		defer rc.Close()
		dst := filepath.Join(dir, "restore-"+time.Now().Format("150405")+".db")
		out, err := os.Create(dst)
		if err != nil {
			return "", err
		}
		defer out.Close()
		if _, err := io.Copy(out, rc); err != nil {
			return "", err
		}
		return dst, nil
	}
	return "", fmt.Errorf("mmm.db not found in archive")
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}
