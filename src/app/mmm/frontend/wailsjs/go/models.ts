export namespace backup {
	
	export class Info {
	    path: string;
	    filename: string;
	    title: string;
	    size: number;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.filename = source["filename"];
	        this.title = source["title"];
	        this.size = source["size"];
	        this.createdAt = source["createdAt"];
	    }
	}

}

export namespace domain {
	
	export class Attachment {
	    id: number;
	    cardId: number;
	    filename: string;
	    mime: string;
	    size: number;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Attachment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.cardId = source["cardId"];
	        this.filename = source["filename"];
	        this.mime = source["mime"];
	        this.size = source["size"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class CardLink {
	    id: number;
	    cardId: number;
	    label: string;
	    target: string;
	    kind: string;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new CardLink(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.cardId = source["cardId"];
	        this.label = source["label"];
	        this.target = source["target"];
	        this.kind = source["kind"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class Tag {
	    id: number;
	    name: string;
	    color: string;
	    x: number;
	    y: number;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Tag(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class Card {
	    id: number;
	    planeId: number;
	    heading: string;
	    body: string;
	    x: number;
	    y: number;
	    w: number;
	    h: number;
	    isRoot: boolean;
	    markdown: string;
	    icon: string;
	    bgColor: string;
	    date: string;
	    childPlaneId?: number;
	    tags?: Tag[];
	    links?: CardLink[];
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Card(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.planeId = source["planeId"];
	        this.heading = source["heading"];
	        this.body = source["body"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.w = source["w"];
	        this.h = source["h"];
	        this.isRoot = source["isRoot"];
	        this.markdown = source["markdown"];
	        this.icon = source["icon"];
	        this.bgColor = source["bgColor"];
	        this.date = source["date"];
	        this.childPlaneId = source["childPlaneId"];
	        this.tags = this.convertValues(source["tags"], Tag);
	        this.links = this.convertValues(source["links"], CardLink);
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Link {
	    id: number;
	    planeId: number;
	    fromCardId: number;
	    toCardId: number;
	    fromAnchor: string;
	    toAnchor: string;
	    color: string;
	    width: number;
	    childPlaneId?: number;
	    createdAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Link(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.planeId = source["planeId"];
	        this.fromCardId = source["fromCardId"];
	        this.toCardId = source["toCardId"];
	        this.fromAnchor = source["fromAnchor"];
	        this.toAnchor = source["toAnchor"];
	        this.color = source["color"];
	        this.width = source["width"];
	        this.childPlaneId = source["childPlaneId"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class Plane {
	    id: number;
	    kind: string;
	    ownerLinkId?: number;
	    viewState: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Plane(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.ownerLinkId = source["ownerLinkId"];
	        this.viewState = source["viewState"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class PlaneContent {
	    plane: Plane;
	    cards: Card[];
	    links: Link[];
	
	    static createFrom(source: any = {}) {
	        return new PlaneContent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.plane = this.convertValues(source["plane"], Plane);
	        this.cards = this.convertValues(source["cards"], Card);
	        this.links = this.convertValues(source["links"], Link);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class TagRelation {
	    fromTagId: number;
	    toTagId: number;
	
	    static createFrom(source: any = {}) {
	        return new TagRelation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fromTagId = source["fromTagId"];
	        this.toTagId = source["toTagId"];
	    }
	}

}

export namespace main {
	
	export class AttachmentPayload {
	    filename: string;
	    mime: string;
	    dataB64: string;
	
	    static createFrom(source: any = {}) {
	        return new AttachmentPayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filename = source["filename"];
	        this.mime = source["mime"];
	        this.dataB64 = source["dataB64"];
	    }
	}
	export class TagView {
	    tags: domain.Tag[];
	    relations: domain.TagRelation[];
	
	    static createFrom(source: any = {}) {
	        return new TagView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tags = this.convertValues(source["tags"], domain.Tag);
	        this.relations = this.convertValues(source["relations"], domain.TagRelation);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace store {
	
	export class PathStep {
	    kind: string;
	    id: number;
	
	    static createFrom(source: any = {}) {
	        return new PathStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.id = source["id"];
	    }
	}
	export class CardPath {
	    steps: PathStep[];
	    targetCardId: number;
	
	    static createFrom(source: any = {}) {
	        return new CardPath(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.steps = this.convertValues(source["steps"], PathStep);
	        this.targetCardId = source["targetCardId"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CardSnapshot {
	    card: domain.Card;
	    links: domain.Link[];
	    tagIds: number[];
	    cardLinks: domain.CardLink[];
	
	    static createFrom(source: any = {}) {
	        return new CardSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.card = this.convertValues(source["card"], domain.Card);
	        this.links = this.convertValues(source["links"], domain.Link);
	        this.tagIds = source["tagIds"];
	        this.cardLinks = this.convertValues(source["cardLinks"], domain.CardLink);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DuplicateGroupResult {
	    cards: domain.Card[];
	
	    static createFrom(source: any = {}) {
	        return new DuplicateGroupResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cards = this.convertValues(source["cards"], domain.Card);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class GroupSnapshot {
	    cards: CardSnapshot[];
	    links: domain.Link[];
	
	    static createFrom(source: any = {}) {
	        return new GroupSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cards = this.convertValues(source["cards"], CardSnapshot);
	        this.links = this.convertValues(source["links"], domain.Link);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class SearchHit {
	    id: number;
	    heading: string;
	    planeId: number;
	
	    static createFrom(source: any = {}) {
	        return new SearchHit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.heading = source["heading"];
	        this.planeId = source["planeId"];
	    }
	}

}

