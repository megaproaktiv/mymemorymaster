package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"

	"mmm/internal/backup"
	"mmm/internal/config"
	"mmm/internal/domain"
	"mmm/internal/store"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the Wails-bound application. Every exported method is callable from
// the frontend.
type App struct {
	ctx     context.Context
	store   *store.Store
	backup  *backup.Manager
	cfg     config.Config
	pending string // deep-link card id captured before the frontend was ready
	mu      sync.Mutex
}

// NewApp creates the application struct.
func NewApp() *App { return &App{} }

// dataDir returns the per-user data directory for mmm, creating it if needed.
func dataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "MyMemoryMaster")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// SetWindowTitle updates the native window title. Used to show the current
// card title when drilling into a card plane.
func (a *App) SetWindowTitle(title string) {
	if a.ctx != nil {
		wailsRuntime.WindowSetTitle(a.ctx, title)
	}
}

// PickFile opens a native open-file dialog and returns the selected path, or an
// empty string if the user cancelled.
func (a *App) PickFile() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("no window context")
	}
	return wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select a file to link",
	})
}

// PickDirectory opens a native directory-picker and returns the selected path.
func (a *App) PickDirectory() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("no window context")
	}
	return wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select a folder to link",
	})
}

// startup opens the database and backup manager.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	dir, err := dataDir()
	if err != nil {
		panic(fmt.Sprintf("data dir: %v", err))
	}
	st, err := store.Open(filepath.Join(dir, "mmm.db"))
	if err != nil {
		panic(fmt.Sprintf("open store: %v", err))
	}
	a.store = st
	a.cfg, _ = config.Load()
	backupDir := a.cfg.BackupDir
	if backupDir == "" {
		backupDir = filepath.Join(dir, "backups")
	}
	bm, err := backup.New(st.DB(), st.Path(), backupDir)
	if err != nil {
		panic(fmt.Sprintf("backup manager: %v", err))
	}
	a.backup = bm
}

// shutdown is called when the app is about to close. It creates a backup
// snapshot so no work is lost, then closes the database.
func (a *App) shutdown(ctx context.Context) {
	if a.backup != nil {
		if _, err := a.backup.Now("auto: on exit"); err != nil {
			fmt.Println("backup on exit failed:", err)
		}
	}
	if a.store != nil {
		_ = a.store.Close()
	}
}

// ---- Planes ----------------------------------------------------------------

// GetRootPlane returns the deck's root plane with its cards and links.
func (a *App) GetRootPlane() (domain.PlaneContent, error) {
	p, err := a.store.RootPlane()
	if err != nil {
		return domain.PlaneContent{}, err
	}
	return a.store.PlaneContent(p.ID)
}

// GetPlane returns a plane with its cards and links.
func (a *App) GetPlane(id int64) (domain.PlaneContent, error) {
	return a.store.PlaneContent(id)
}

// OpenLinkPlane drills into a link, returning (creating on first use) its
// child plane with content.
func (a *App) OpenLinkPlane(linkID int64) (domain.PlaneContent, error) {
	p, err := a.store.OpenLinkPlane(linkID)
	if err != nil {
		return domain.PlaneContent{}, err
	}
	return a.store.PlaneContent(p.ID)
}

// OpenCardPlane drills into a card, returning (creating on first use) the
// card's own child plane with content.
func (a *App) OpenCardPlane(cardID int64) (domain.PlaneContent, error) {
	p, err := a.store.OpenCardPlane(cardID)
	if err != nil {
		return domain.PlaneContent{}, err
	}
	return a.store.PlaneContent(p.ID)
}

// SaveViewState persists pan/zoom for a plane.
func (a *App) SaveViewState(planeID int64, viewState string) error {
	return a.store.SaveViewState(planeID, viewState)
}

// ---- Cards -----------------------------------------------------------------

// CreateCard adds a card at (x,y) on a plane.
func (a *App) CreateCard(planeID int64, x, y float64) (domain.Card, error) {
	return a.store.CreateCard(planeID, x, y)
}

// UpdateCard sets heading and body of a card.
func (a *App) UpdateCard(id int64, heading, body string) error {
	return a.store.UpdateCard(id, heading, body)
}

// MoveCard repositions a card.
func (a *App) MoveCard(id int64, x, y float64) error {
	return a.store.MoveCard(id, x, y)
}

// ResizeCard changes a card's width and height.
func (a *App) ResizeCard(id int64, w, h float64) error {
	return a.store.ResizeCard(id, w, h)
}

// DeleteCard removes a card (root card cannot be deleted).
func (a *App) DeleteCard(id int64) error {
	return a.store.DeleteCard(id)
}

// DeleteCardWithUndo deletes a card and returns a snapshot for undo (Cmd+Z).
func (a *App) DeleteCardWithUndo(id int64) (store.CardSnapshot, error) {
	return a.store.DeleteCardReturningSnapshot(id)
}

// RestoreCard re-creates a previously deleted card from its undo snapshot.
func (a *App) RestoreCard(snap store.CardSnapshot) error {
	return a.store.RestoreCardSnapshot(snap)
}

// ToggleFullscreen switches the window between fullscreen and normal.
func (a *App) ToggleFullscreen() {
	if a.ctx == nil {
		return
	}
	if wailsRuntime.WindowIsFullscreen(a.ctx) {
		wailsRuntime.WindowUnfullscreen(a.ctx)
	} else {
		wailsRuntime.WindowFullscreen(a.ctx)
	}
}

// DuplicateCard creates a copy of a card on a plane at (x,y). Used for
// copy/paste of cards.
func (a *App) DuplicateCard(cardID, planeID int64, x, y float64) (domain.Card, error) {
	return a.store.DuplicateCardTo(cardID, planeID, x, y)
}

// DuplicateCards copies several cards (and the links among them) onto a plane,
// offset by (dx,dy). Used for multi-select copy/paste.
func (a *App) DuplicateCards(ids []int64, planeID int64, dx, dy float64) (store.DuplicateGroupResult, error) {
	return a.store.DuplicateCardsTo(ids, planeID, dx, dy)
}

// DeleteCardsWithUndo deletes several cards and returns a group snapshot for
// undo (Cmd+Z).
func (a *App) DeleteCardsWithUndo(ids []int64) (store.GroupSnapshot, error) {
	return a.store.DeleteCardsReturningSnapshot(ids)
}

// RestoreCards re-creates a previously deleted group of cards from its undo
// snapshot.
func (a *App) RestoreCards(snap store.GroupSnapshot) error {
	return a.store.RestoreGroupSnapshot(snap)
}

// ---- Card links (URL / file) ----------------------------------------------

// ListCardLinks returns the external links attached to a card.
func (a *App) ListCardLinks(cardID int64) ([]domain.CardLink, error) {
	return a.store.CardLinksForCard(cardID)
}

// AddCardLink attaches a URL or file link to a card.
func (a *App) AddCardLink(cardID int64, label, target, kind string) (domain.CardLink, error) {
	return a.store.AddCardLink(cardID, label, target, kind)
}

// SetCardLinkLabel updates a card link's short label (max 16 characters).
func (a *App) SetCardLinkLabel(id int64, label string) error {
	return a.store.SetCardLinkLabel(id, label)
}

// DeleteCardLink removes an external link from a card.
func (a *App) DeleteCardLink(id int64) error {
	return a.store.DeleteCardLink(id)
}

// OpenCardLink opens an external card link in the OS default application
// (browser for URLs, default viewer/finder for file paths).
func (a *App) OpenCardLink(id int64) error {
	link, err := a.store.CardLink(id)
	if err != nil {
		return err
	}
	return openTargetWithOS(link.Target)
}

// GetCardDocument returns the Markdown document of a card.
func (a *App) GetCardDocument(id int64) (string, error) {
	return a.store.CardMarkdown(id)
}

// SaveCardDocument stores the Markdown document of a card.
func (a *App) SaveCardDocument(id int64, markdown string) error {
	return a.store.SaveCardMarkdown(id, markdown)
}

// SetCardIcon sets the card's type icon (note, project, factory, calendar, idea).
func (a *App) SetCardIcon(id int64, icon string) error {
	return a.store.SetCardIcon(id, icon)
}

// SetCardBg sets the card's (always-light) background color.
func (a *App) SetCardBg(id int64, color string) error {
	return a.store.SetCardBg(id, color)
}

// SetCardDate sets the card's date (YYYY-MM-DD, empty clears it).
func (a *App) SetCardDate(id int64, date string) error {
	return a.store.SetCardDate(id, date)
}

// ---- Links -----------------------------------------------------------------

// CreateLink connects two cards (used when dragging one card onto another).
func (a *App) CreateLink(fromCardID, toCardID int64) (domain.Link, error) {
	return a.store.CreateLink(fromCardID, toCardID)
}

// CreateLinkAnchored connects two cards recording the anchor side (center,
// left, right, top, bottom) on each card.
func (a *App) CreateLinkAnchored(fromCardID, toCardID int64, fromAnchor, toAnchor string) (domain.Link, error) {
	return a.store.CreateLinkAnchored(fromCardID, toCardID, fromAnchor, toAnchor)
}

// DeleteLink removes a link.
func (a *App) DeleteLink(id int64) error {
	return a.store.DeleteLink(id)
}

// SetLinkStyle sets a link's color and stroke width (1, 4 or 8).
func (a *App) SetLinkStyle(id int64, color string, width int) error {
	return a.store.SetLinkStyle(id, color, width)
}

// ---- Tags ------------------------------------------------------------------

// ListTags returns all tags.
func (a *App) ListTags() ([]domain.Tag, error) { return a.store.ListTags() }

// CreateTag creates (or reuses) a tag by name.
func (a *App) CreateTag(name, color string) (domain.Tag, error) {
	return a.store.CreateTag(name, color)
}

// AttachTag attaches a tag to a card.
func (a *App) AttachTag(cardID, tagID int64) error { return a.store.AttachTag(cardID, tagID) }

// DetachTag removes a tag from a card.
func (a *App) DetachTag(cardID, tagID int64) error { return a.store.DetachTag(cardID, tagID) }

// MoveTag repositions a tag in the tag view.
func (a *App) MoveTag(id int64, x, y float64) error { return a.store.MoveTag(id, x, y) }

// LinkTags relates two tags in the tag view.
func (a *App) LinkTags(fromTagID, toTagID int64) error { return a.store.LinkTags(fromTagID, toTagID) }

// UnlinkTags removes a relation between two tags.
func (a *App) UnlinkTags(a1, b1 int64) error { return a.store.UnlinkTags(a1, b1) }

// DeleteTag removes a tag entirely.
func (a *App) DeleteTag(id int64) error { return a.store.DeleteTag(id) }

// SetTagColor updates a tag's color.
func (a *App) SetTagColor(id int64, color string) error { return a.store.SetTagColor(id, color) }

// TagView bundles tags and their relations for the tag view.
type TagView struct {
	Tags      []domain.Tag         `json:"tags"`
	Relations []domain.TagRelation `json:"relations"`
}

// GetTagView returns all tags and their relations.
func (a *App) GetTagView() (TagView, error) {
	tags, err := a.store.ListTags()
	if err != nil {
		return TagView{}, err
	}
	rels, err := a.store.TagRelations()
	if err != nil {
		return TagView{}, err
	}
	return TagView{Tags: tags, Relations: rels}, nil
}

// CardsWithTag returns all cards carrying the given tag (for the tag view's
// "cards with this tag" list).
func (a *App) CardsWithTag(tagID int64) ([]domain.Card, error) {
	return a.store.CardsWithTag(tagID)
}

// BuildCardPath returns the drill-in steps from the root to a card's plane,
// used to navigate (deep-link) to a nested card.
func (a *App) BuildCardPath(cardID int64) (store.CardPath, error) {
	return a.store.BuildCardPath(cardID)
}

// SearchCards returns cards whose heading matches the query, across the deck.
func (a *App) SearchCards(query string, limit int) ([]store.SearchHit, error) {
	return a.store.SearchCards(query, limit)
}

// ---- Deep links (mmm://card/<id>) ------------------------------------------

// handleURL parses an incoming mmm:// deep link and routes it to the frontend.
// Called by Wails' OnUrlOpen for both cold start and while running.
func (a *App) handleURL(url string) {
	id := parseCardDeepLink(url)
	if id == 0 {
		return
	}
	a.mu.Lock()
	a.pending = strconv.FormatInt(id, 10)
	a.mu.Unlock()
	// If the frontend is already up, notify it immediately.
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "deeplink:card", id)
		wailsRuntime.WindowShow(a.ctx)
	}
}

// parseCardDeepLink extracts the card id from mmm://card/<id> (also tolerates
// mmm:card/<id> and a trailing slash). Returns 0 if not a card link.
func parseCardDeepLink(url string) int64 {
	s := strings.TrimSpace(url)
	s = strings.TrimPrefix(s, "mmm://")
	s = strings.TrimPrefix(s, "mmm:")
	s = strings.Trim(s, "/")
	if !strings.HasPrefix(s, "card/") {
		return 0
	}
	idStr := strings.TrimPrefix(s, "card/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		return 0
	}
	return id
}

// ConsumePendingDeepLink returns and clears a deep-link card id captured before
// the frontend was ready (cold start). Returns 0 if none.
func (a *App) ConsumePendingDeepLink() int64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.pending == "" {
		return 0
	}
	id, _ := strconv.ParseInt(a.pending, 10, 64)
	a.pending = ""
	return id
}

// CardDeepLink returns the external deep-link URL for a card.
func (a *App) CardDeepLink(cardID int64) string {
	return fmt.Sprintf("mmm://card/%d", cardID)
}

// ---- Attachments -----------------------------------------------------------

// ListAttachments returns a card's attachments (metadata).
func (a *App) ListAttachments(cardID int64) ([]domain.Attachment, error) {
	return a.store.ListAttachments(cardID)
}

// AddAttachment stores a file against a card. The file contents are passed as
// a base64-encoded string (the frontend reads the file and encodes it).
func (a *App) AddAttachment(cardID int64, filename, mime, dataB64 string) (domain.Attachment, error) {
	data, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return domain.Attachment{}, fmt.Errorf("decode attachment: %w", err)
	}
	return a.store.AddAttachment(cardID, filename, mime, data)
}

// AttachmentData returns the filename, MIME type and base64-encoded bytes of an
// attachment, for viewing (inline image) or opening (PDF) in the frontend.
func (a *App) AttachmentData(id int64) (AttachmentPayload, error) {
	filename, mime, data, err := a.store.AttachmentData(id)
	if err != nil {
		return AttachmentPayload{}, err
	}
	return AttachmentPayload{
		Filename: filename,
		Mime:     mime,
		DataB64:  base64.StdEncoding.EncodeToString(data),
	}, nil
}

// AttachmentPayload carries attachment bytes to the frontend as base64.
type AttachmentPayload struct {
	Filename string `json:"filename"`
	Mime     string `json:"mime"`
	DataB64  string `json:"dataB64"`
}

// DeleteAttachment removes an attachment.
func (a *App) DeleteAttachment(id int64) error { return a.store.DeleteAttachment(id) }

// OpenAttachmentExternally writes the attachment to a temp file and opens it
// with the operating system's default application (used for PDFs). Returns the
// temp path that was opened.
func (a *App) OpenAttachmentExternally(id int64) (string, error) {
	filename, _, data, err := a.store.AttachmentData(id)
	if err != nil {
		return "", err
	}
	// Preserve the original extension so the OS picks the right viewer.
	name := filepath.Base(filename)
	if name == "" || name == "." {
		name = fmt.Sprintf("attachment-%d", id)
	}
	path := filepath.Join(os.TempDir(), fmt.Sprintf("mmm-%d-%s", id, name))
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("write temp file: %w", err)
	}
	if err := openWithOS(path); err != nil {
		return "", err
	}
	return path, nil
}

// openWithOS opens a file with the platform default application.
func openWithOS(path string) error {
	return openTargetWithOS(path)
}

// openTargetWithOS opens a URL or file path with the platform default handler.
func openTargetWithOS(target string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", target)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", target)
	default: // linux and others
		cmd = exec.Command("xdg-open", target)
	}
	return cmd.Start()
}

// ---- Backup ----------------------------------------------------------------

// BackupNow creates a zipped snapshot on demand with an optional title (max 32
// characters).
func (a *App) BackupNow(title string) (backup.Info, error) { return a.backup.Now(title) }

// ListBackups returns available backups, newest first.
func (a *App) ListBackups() ([]backup.Info, error) { return a.backup.List() }

// GetBackupDir returns the current backup directory.
func (a *App) GetBackupDir() string { return a.backup.Dir() }

// SetBackupDir changes and persists the backup directory (in the config file,
// so it survives restarts independently of the deck database).
func (a *App) SetBackupDir(dir string) error {
	if err := a.backup.SetDir(dir); err != nil {
		return err
	}
	a.cfg.BackupDir = dir
	return config.Save(a.cfg)
}

// PickBackupDir opens a folder picker and, if chosen, sets the backup dir.
func (a *App) PickBackupDir() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("no window context")
	}
	dir, err := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Choose backup folder",
	})
	if err != nil || dir == "" {
		return "", err
	}
	if err := a.SetBackupDir(dir); err != nil {
		return "", err
	}
	return dir, nil
}

// Restore recovers the deck from a backup archive. The backup's database is
// extracted and applied through the live connection (so no file swap under the
// open WAL connection, and the change is visible immediately without restart).
func (a *App) Restore(path string) error {
	extracted, err := a.backup.ExtractForRestore(path)
	if err != nil {
		return err
	}
	defer os.Remove(extracted)
	return a.store.RestoreFromFile(extracted)
}

// ---- Settings --------------------------------------------------------------

// GetLanguage returns the stored UI language ("en" default).
func (a *App) GetLanguage() (string, error) {
	lang, err := a.store.Meta("language")
	if err != nil {
		return "en", err
	}
	if lang == "" {
		return "en", nil
	}
	return lang, nil
}

// SetLanguage stores the UI language.
func (a *App) SetLanguage(lang string) error { return a.store.SetMeta("language", lang) }
