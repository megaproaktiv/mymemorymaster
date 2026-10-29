// Package domain defines the core data types of My Memory Master (mmm):
// planes, cards, links, tags and attachments. See documentation/architecture.md.
package domain

// PlaneKind distinguishes the role of a plane in the deck.
type PlaneKind string

const (
	// PlaneRoot is the single entry plane of the deck.
	PlaneRoot PlaneKind = "root"
	// PlaneLink is a plane reached by drilling into a link.
	PlaneLink PlaneKind = "link_plane"
	// PlaneCard is a plane reached by drilling into a card.
	PlaneCard PlaneKind = "card_plane"
	// PlaneTagView is the separate plane showing tag relations.
	PlaneTagView PlaneKind = "tag_view"
)

// Plane is one 2D layer of cards and links.
type Plane struct {
	ID          int64     `json:"id"`
	Kind        PlaneKind `json:"kind"`
	OwnerLinkID *int64    `json:"ownerLinkId,omitempty"`
	ViewState   string    `json:"viewState"` // JSON: pan/zoom
	CreatedAt   string    `json:"createdAt"`
	UpdatedAt   string    `json:"updatedAt"`
}

// Card is a node on a plane: a rounded rectangle with a bold heading, a
// divider and a short body. A card owns a Markdown document (with attachments)
// and may also own a child plane of further cards (drill into the card).
type Card struct {
	ID           int64   `json:"id"`
	PlaneID      int64   `json:"planeId"`
	Heading      string  `json:"heading"`
	Body         string  `json:"body"`
	X            float64 `json:"x"`
	Y            float64 `json:"y"`
	W            float64 `json:"w"`
	H            float64 `json:"h"`
	IsRoot       bool    `json:"isRoot"`
	Markdown     string  `json:"markdown"`
	Icon         string  `json:"icon"`
	BgColor      string  `json:"bgColor"`
	Date         string  `json:"date"`
	ChildPlaneID *int64  `json:"childPlaneId,omitempty"`
	Tags         []Tag   `json:"tags,omitempty"`
	Links        []CardLink `json:"links,omitempty"`
	CreatedAt    string  `json:"createdAt"`
	UpdatedAt    string  `json:"updatedAt"`
}

// Link connects two cards on the same plane. It may own a child plane that is
// opened by drilling into the link. Anchors record which side of each card the
// connector attaches to (center, left, right, top, bottom).
type Link struct {
	ID           int64  `json:"id"`
	PlaneID      int64  `json:"planeId"`
	FromCardID   int64  `json:"fromCardId"`
	ToCardID     int64  `json:"toCardId"`
	FromAnchor   string `json:"fromAnchor"`
	ToAnchor     string `json:"toAnchor"`
	Color        string `json:"color"`
	Width        int    `json:"width"`
	ChildPlaneID *int64 `json:"childPlaneId,omitempty"`
	CreatedAt    string `json:"createdAt"`
}

// CardLink is an external link attached to a card: a URL or a file-system path.
type CardLink struct {
	ID        int64  `json:"id"`
	CardID    int64  `json:"cardId"`
	Label     string `json:"label"`
	Target    string `json:"target"`
	Kind      string `json:"kind"` // "url" | "file"
	CreatedAt string `json:"createdAt"`
}

// Tag is a label shown as a luggage-tag on cards and related to other tags in
// the tag view.
type Tag struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Color     string  `json:"color"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	CreatedAt string  `json:"createdAt"`
}

// TagRelation is an edge between two tags in the tag view.
type TagRelation struct {
	FromTagID int64 `json:"fromTagId"`
	ToTagID   int64 `json:"toTagId"`
}

// Attachment is a file attached to a card's document.
type Attachment struct {
	ID        int64  `json:"id"`
	CardID    int64  `json:"cardId"`
	Filename  string `json:"filename"`
	Mime      string `json:"mime"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"createdAt"`
}

// PlaneContent bundles everything the frontend needs to render one plane.
type PlaneContent struct {
	Plane Plane  `json:"plane"`
	Cards []Card `json:"cards"`
	Links []Link `json:"links"`
}
