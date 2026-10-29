package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveLoadRoundTrip(t *testing.T) {
	// Redirect UserConfigDir to a temp location.
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)       // Linux
	t.Setenv("HOME", tmp)                  // macOS fallback uses ~/Library
	// On macOS os.UserConfigDir = ~/Library/Application Support; ensure it exists.
	_ = os.MkdirAll(filepath.Join(tmp, "Library", "Application Support"), 0o755)

	in := Config{BackupDir: "/some/backup/path", Language: "de"}
	if err := Save(in); err != nil {
		t.Fatalf("save: %v", err)
	}
	out, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if out.BackupDir != in.BackupDir || out.Language != in.Language {
		t.Errorf("round-trip mismatch: got %+v want %+v", out, in)
	}
}

func TestLoadMissingReturnsZero(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	t.Setenv("HOME", tmp)
	_ = os.MkdirAll(filepath.Join(tmp, "Library", "Application Support"), 0o755)

	c, err := Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if c.BackupDir != "" {
		t.Errorf("expected empty config, got %+v", c)
	}
}
