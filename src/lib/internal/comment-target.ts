// Finds the element a comment pin is meant for, in a frame's own document.
// Frames are same-origin iframes, so the host reads their DOM directly. Their
// elements belong to another realm: test them by name, never with instanceof.

import type { CommentAnchor } from '../comments.js';

/** A box in the frame's CSS pixels, from its top-left corner. */
export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** An element a pin can attach to. */
export interface CommentTarget {
	element: Element;
	box: Box;
	/** Corner radius in frame pixels, so the highlight takes the element's shape. */
	radius: number;
	/** What it is and what it says, e.g. `button “Add prompts”`. */
	label: string;
}

/** Where the pointer is aiming in comment mode. */
export interface CommentAim {
	frame: string;
	/** Where a pin would go: the pointer, moved onto the target if it is pulled to one. */
	x: number;
	y: number;
	/** The pointer itself. */
	point: { x: number; y: number };
	target?: CommentTarget;
}

/** How far the pull reaches, in screen pixels. */
export const MAGNET = 14;
/** Elements covering more of the frame than this are layout, not something to comment on. */
const LAYOUT_SHARE = 0.6;
/** Controls up to this size take in what they contain, as a button takes its icon and text. */
const COMPACT = { width: 480, height: 56 };

const NAMED = '[data-pf-comment]';
const CONTROL =
	'a[href],button,input,select,textarea,label,summary,[contenteditable],[tabindex]:not([tabindex="-1"]),' +
	'[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option],' +
	'[data-pf-link],[data-pf-interactive]';
const MEDIA = 'img,svg,canvas,video,picture,iframe';
const CONTENT = 'h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,blockquote,pre,figcaption,caption,legend';
const GROUP =
	'section,article,aside,nav,header,footer,form,table,tr,fieldset,dialog,figure,ul,ol,' +
	'[role=region],[role=dialog],[role=row],[role=grid],[role=table],[role=tablist],[role=listitem],' +
	'[role=cell],[role=gridcell],[role=columnheader]';

const SVG = 'http://www.w3.org/2000/svg';
const TRANSPARENT = /^transparent$|,\s*0\)$|\/\s*0\)$/;

/** The frame's document once it has hydrated, or undefined (an image preview, still loading, gone). */
export function frameDocument(iframe: Element | null | undefined, frame: string): Document | undefined {
	try {
		const doc = (iframe as HTMLIFrameElement | null)?.contentDocument;
		return doc?.documentElement.dataset.pfFrameReady === frame ? doc : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Where a pin goes for a pointer at `x`, `y` on a frame. Without a document
 * (or with `free`), the pin stays where the pointer is.
 */
export function aimAt(frame: string, x: number, y: number, doc: Document | undefined, radius: number): CommentAim {
	const point = { x, y };
	const target = doc && targetAt(doc, x, y, radius);
	if (!target) return { frame, x, y, point };
	const { box } = target;
	return {
		frame,
		x: clamp(x, box.x + 1, box.x + box.width - 1),
		y: clamp(y, box.y + 1, box.y + box.height - 1),
		point,
		target
	};
}

/**
 * The element nearest the point, or undefined for open space. Under the
 * pointer, the innermost meaningful element wins. A smaller one within
 * `radius` pulls the pointer onto it, as long as it sits inside that element.
 */
export function targetAt(doc: Document, x: number, y: number, radius: number): CommentTarget | undefined {
	const scan = new Scan(doc);
	const found = new Map<Element, Box>();
	for (const [dx, dy] of probes(radius)) {
		const px = x + dx;
		const py = y + dy;
		if (px < 0 || py < 0 || px >= scan.width || py >= scan.height) continue;
		for (const hit of doc.elementsFromPoint(px, py)) {
			const element = scan.target(hit);
			if (element && !found.has(element)) found.set(element, scan.box(element));
		}
	}

	let inner: { element: Element; box: Box } | undefined;
	for (const [element, box] of found) {
		if (distance(box, x, y) === 0 && (!inner || area(box) < area(inner.box))) inner = { element, box };
	}
	let pull: { element: Element; box: Box; gap: number } | undefined;
	for (const [element, box] of found) {
		const gap = distance(box, x, y);
		if (gap === 0 || gap > radius) continue;
		if (inner && !(area(box) < area(inner.box) && inner.element.contains(element))) continue;
		if (!pull || gap < pull.gap || (gap === pull.gap && area(box) < area(pull.box))) pull = { element, box, gap };
	}
	const chosen = pull ?? inner;
	return chosen && scan.describe(chosen.element, chosen.box);
}

/** The meaningful element around this one, for when the pin meant more than it caught. */
export function widen(target: CommentTarget): CommentTarget | undefined {
	const doc = target.element.ownerDocument;
	if (!doc.defaultView) return undefined;
	const scan = new Scan(doc);
	for (let element = target.element.parentElement; element; element = element.parentElement) {
		if (!scan.candidate(element)) continue;
		const box = scan.box(element);
		if (area(box) > area(target.box) * 1.02) return scan.describe(element, box);
	}
	return undefined;
}

/** What a thread stores about its target. */
export function anchorOf(target: CommentTarget): CommentAnchor {
	const { box } = target;
	return {
		selector: selectorOf(target.element),
		label: target.label,
		text: shorten(visibleText(target.element), 300),
		x: box.x,
		y: box.y,
		width: box.width,
		height: box.height
	};
}

/** One pass over a document, remembering what it has measured. */
class Scan {
	readonly width: number;
	readonly height: number;
	private view: Window;
	private ranks = new Map<Element, number>();

	constructor(doc: Document) {
		this.view = doc.defaultView!;
		this.width = this.view.innerWidth;
		this.height = this.view.innerHeight;
	}

	/** The visible part of an element's box. */
	box(element: Element): Box {
		const r = element.getBoundingClientRect();
		const x = Math.max(r.left, 0);
		const y = Math.max(r.top, 0);
		return {
			x,
			y,
			width: Math.max(Math.min(r.right, this.width) - x, 0),
			height: Math.max(Math.min(r.bottom, this.height) - y, 0)
		};
	}

	/**
	 * How much an element means on its own: 0 for wrappers and layout, then
	 * groups and boxes, content, controls and media, and elements the frame
	 * names with `data-pf-comment`.
	 */
	rank(element: Element): number {
		let rank = this.ranks.get(element);
		if (rank === undefined) {
			rank = this.measure(element);
			this.ranks.set(element, rank);
		}
		return rank;
	}

	private measure(element: Element): number {
		const name = element.localName;
		if (name === 'html' || name === 'body' || name === 'head') return 0;
		// Paths and groups inside an SVG belong to the SVG.
		if (element.namespaceURI === SVG && (name !== 'svg' || element.parentElement?.closest('svg'))) return 0;
		const r = element.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) return 0;
		const style = this.view.getComputedStyle(element);
		if (style.visibility !== 'visible' || style.opacity === '0') return 0;
		if (element.matches(NAMED)) return 5;
		if (r.width * r.height > this.width * this.height * LAYOUT_SHARE) return 0;
		if (element.matches(CONTROL) || element.matches(MEDIA)) return 4;
		if (element.matches(CONTENT) || ownText(element)) return 3;
		if (element.matches(GROUP) || boxed(style)) return 2;
		return 0;
	}

	candidate(element: Element) {
		return this.rank(element) > 0;
	}

	/** The element a hit stands for: its nearest meaningful ancestor, taken in by a compact control. */
	target(hit: Element): Element | undefined {
		let element: Element | null = hit;
		while (element && !this.candidate(element)) element = element.parentElement;
		if (!element) return undefined;
		const control = element.parentElement?.closest(CONTROL);
		if (control && this.candidate(control)) {
			const r = control.getBoundingClientRect();
			if (r.width <= COMPACT.width && r.height <= COMPACT.height) element = control;
		}
		// A wrapper the same size as what it wraps is the same thing; keep the one that means more.
		for (let parent = element.parentElement; parent && sameBox(parent, element); parent = parent.parentElement) {
			if (this.rank(parent) < this.rank(element)) break;
			element = parent;
		}
		return element;
	}

	describe(element: Element, box: Box): CommentTarget {
		const radius = parseFloat(this.view.getComputedStyle(element).borderTopLeftRadius) || 0;
		return { element, box, radius: Math.min(radius, box.width / 2, box.height / 2), label: labelOf(element) };
	}
}

function labelOf(element: Element): string {
	const name =
		element.getAttribute('data-pf-comment') ||
		element.getAttribute('aria-label') ||
		element.getAttribute('alt') ||
		element.getAttribute('title') ||
		element.getAttribute('placeholder') ||
		visibleText(element) ||
		// A label or wrapper around a field is named by the field.
		element.querySelector('input,textarea,select')?.getAttribute('placeholder') ||
		element.querySelector('input,textarea,select')?.getAttribute('aria-label');
	const label = name ? `${kindOf(element)} “${shorten(name, 60)}”` : kindOf(element);
	const column = columnOf(element);
	return column ? `${label} in “${shorten(column, 40)}”` : label;
}

/** A table cell's column heading, so a bare number says what it counts. */
function columnOf(element: Element): string | undefined {
	if (element.localName !== 'td') return undefined;
	const index = [...(element.parentElement?.children ?? [])].indexOf(element);
	const head = element.closest('table')?.querySelector('thead tr')?.children[index];
	return head ? visibleText(head) || undefined : undefined;
}

const ROLES: Record<string, string> = {
	button: 'button', link: 'link', tab: 'tab', menuitem: 'menu item', checkbox: 'checkbox',
	switch: 'switch', option: 'option', row: 'row', cell: 'cell', gridcell: 'cell',
	columnheader: 'column header', listitem: 'list item', region: 'region', dialog: 'dialog',
	tablist: 'tabs', grid: 'table', table: 'table', img: 'image'
};
const TAGS: Record<string, string> = {
	a: 'link', button: 'button', select: 'menu', textarea: 'field', label: 'label', summary: 'button',
	img: 'image', picture: 'image', svg: 'graphic', canvas: 'graphic', video: 'video', iframe: 'embed',
	h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
	p: 'text', li: 'list item', td: 'cell', th: 'column header', tr: 'row', table: 'table',
	ul: 'list', ol: 'list', nav: 'navigation', header: 'header', footer: 'footer', aside: 'sidebar',
	section: 'section', article: 'article', form: 'form', dialog: 'dialog', figure: 'figure',
	blockquote: 'quote', pre: 'code', caption: 'caption', figcaption: 'caption', legend: 'legend'
};

/** Tags that say more than a role a frame gives them, e.g. a table row that is also a link. */
const STRUCTURE = new Set(['tr', 'td', 'th', 'li']);

function kindOf(element: Element): string {
	if (STRUCTURE.has(element.localName)) return TAGS[element.localName];
	const role = ROLES[element.getAttribute('role') ?? ''];
	if (role) return role;
	if (element.localName === 'input') {
		const type = element.getAttribute('type') ?? 'text';
		return type === 'checkbox' || type === 'radio' ? type : type === 'button' || type === 'submit' ? 'button' : 'field';
	}
	return TAGS[element.localName] ?? (ownText(element) ? 'text' : 'box');
}

/** A short path from the nearest ancestor with an id, by tag and position. */
function selectorOf(element: Element): string {
	const parts: string[] = [];
	for (let node: Element | null = element; node && node.localName !== 'html'; node = node.parentElement) {
		if (node.id) {
			parts.unshift(`#${CSS.escape(node.id)}`);
			break;
		}
		let part = node.localName;
		const twins = node.parentElement
			? [...node.parentElement.children].filter((child) => child.localName === node!.localName)
			: [];
		if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`;
		parts.unshift(part);
	}
	return parts.join(' > ');
}

function visibleText(element: Element): string {
	const text = (element as HTMLElement).innerText ?? element.textContent ?? '';
	return text.replace(/\s+/g, ' ').trim();
}

function ownText(element: Element) {
	for (const node of element.childNodes) if (node.nodeType === 3 && node.textContent?.trim()) return true;
	return false;
}

function boxed(style: CSSStyleDeclaration) {
	if (!TRANSPARENT.test(style.backgroundColor) || style.backgroundImage !== 'none' || style.boxShadow !== 'none') return true;
	return (['Top', 'Right', 'Bottom', 'Left'] as const).some(
		(side) => parseFloat(style[`border${side}Width`]) > 0 && !TRANSPARENT.test(style[`border${side}Color`])
	);
}

function sameBox(a: Element, b: Element) {
	const r = a.getBoundingClientRect();
	const s = b.getBoundingClientRect();
	return Math.abs(r.left - s.left) < 1 && Math.abs(r.top - s.top) < 1
		&& Math.abs(r.right - s.right) < 1 && Math.abs(r.bottom - s.bottom) < 1;
}

/** The pointer, then rings around it, so nearby elements are found as well as the one under it. */
function probes(radius: number): [number, number][] {
	const points: [number, number][] = [[0, 0]];
	for (const [reach, count] of [[radius / 2, 4], [radius, 8]] as const) {
		for (let i = 0; i < count; i++) {
			const angle = (i / count) * Math.PI * 2 + (count === 4 ? Math.PI / 4 : 0);
			points.push([Math.cos(angle) * reach, Math.sin(angle) * reach]);
		}
	}
	return points;
}

function distance(box: Box, x: number, y: number) {
	const dx = Math.max(box.x - x, 0, x - (box.x + box.width));
	const dy = Math.max(box.y - y, 0, y - (box.y + box.height));
	return Math.hypot(dx, dy);
}

const area = (box: Box) => box.width * box.height;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
