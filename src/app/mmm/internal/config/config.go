// Package config persists user settings in a JSON file independent of the
// deck database (so settings like the backup directory survive even if the DB
// is moved or restored). The file lives at os.UserConfigDir()/mmm/config.json.
package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Config holds user-level settings.
type Config struct {
	BackupDir string `json:"backupDir"`
	Language  string `json:"language"`
}

// Dir returns the config directory (created if missing).
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "mmm")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func path() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

// Load reads the config file, returning a zero Config if it does not exist.
func Load() (Config, error) {
	var c Config
	p, err := path()
	if err != nil {
		return c, err
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return c, nil
		}
		return c, err
	}
	_ = json.Unmarshal(data, &c)
	return c, nil
}

// Save writes the config file atomically.
func Save(c Config) error {
	p, err := path()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}
