import { resolve } from 'node:path';
import { CommentError, CommentStore } from './comment-store.js';
import { MAX_IMAGE_BYTES, MAX_IMAGES } from './image-limits.js';
import type { CommentAnchor, CommentAuthor, CommentsSnapshot } from '../comments.js';

export interface CommentsRequest {
	request: Request;
	url: URL;
}

export interface ServerCommentsConfig<E extends CommentsRequest> {
	/** SQLite file, created with its directory if missing. `:memory:` for tests. */
	database: string;
	/** Where the host mounts the endpoints, e.g. `/comments`. */
	path: string;
	/** The signed-in viewer, or null. Usually read from the host's sign-in session. */
	user: (event: E) => Promise<CommentAuthor | null> | CommentAuthor | null;
	/** Let signed-out viewers read comments. Writing always requires a user. Default: false. */
	public?: boolean;
}

const MAX_BODY = 5000;
const MAX_IMAGE_SIDE = 20_000;
// Recognised by their first bytes, not by the type the browser claims.
const IMAGE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
	'image/png': (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	'image/jpeg': (b) => starts(b, [0xff, 0xd8, 0xff]),
	'image/gif': (b) => starts(b, [0x47, 0x49, 0x46, 0x38]),
	'image/webp': (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b.subarray(8), [0x57, 0x45, 0x42, 0x50])
};
const MAX_REQUEST = 32 * 1024;
const FRAME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEEPALIVE_MS = 25_000;
const noStore = { 'Cache-Control': 'no-store' };

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: noStore });
const fail = (status: number, error: string) => json({ error }, status);

function text(value: unknown, max: number): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

const starts = (bytes: Uint8Array, prefix: number[]) => prefix.every((byte, i) => bytes[i] === byte);

/** The text of a comment. With `optional`, it may be empty: the comment has images. */
function body(value: unknown, optional = false): string {
	if (typeof value !== 'string' && !(optional && value === undefined)) {
		throw new CommentError(400, 'A comment needs some text or an image.');
	}
	const normalized = (value ?? '').replace(/\r\n?/g, '\n').trim();
	if (!normalized && !optional) throw new CommentError(400, 'A comment needs some text or an image.');
	if (normalized.length > MAX_BODY) throw new CommentError(413, `Comments are limited to ${MAX_BODY} characters.`);
	return normalized;
}

function coordinate(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000) {
		throw new CommentError(400, 'Invalid comment position.');
	}
	return Math.round(value * 10) / 10;
}

function imageIds(value: unknown): number[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || !value.every((id) => Number.isSafeInteger(id) && id > 0)) {
		throw new CommentError(400, 'Invalid images.');
	}
	const ids = [...new Set(value as number[])];
	if (ids.length > MAX_IMAGES) throw new CommentError(400, `A comment can have up to ${MAX_IMAGES} images.`);
	return ids;
}

function side(value: string | null): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1 || n > MAX_IMAGE_SIDE) throw new CommentError(400, 'Invalid image size.');
	return n;
}

function anchor(value: unknown): CommentAnchor | null {
	if (value === undefined || value === null) return null;
	const input = typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
	const selector = text(input.selector, 1000);
	const label = text(input.label, 200);
	if (!selector || !label) throw new CommentError(400, 'Invalid comment anchor.');
	return {
		selector,
		label,
		text: text(input.text, 500) ?? '',
		x: coordinate(input.x),
		y: coordinate(input.y),
		width: coordinate(input.width),
		height: coordinate(input.height)
	};
}

/**
 * The open store of each comment endpoint in this process. On `globalThis`, so
 * it outlives module reloads in development: a reload reuses the open
 * database instead of opening another, and a reload that names a different
 * database is refused instead of silently showing and writing other comments.
 */
const REGISTRY = Symbol.for('paraframe.comment-stores');
type Registry = Map<string, { database: string; store: CommentStore }>;
const stores = ((globalThis as Record<symbol, unknown>)[REGISTRY] ??= new Map()) as Registry;

/** Server-only comment endpoints backed by SQLite. Import from paraframe/server. */
export class ServerComments<E extends CommentsRequest = CommentsRequest> {
	private config: ServerCommentsConfig<E>;
	/** A `:memory:` database belongs to this instance alone (tests). */
	private memory?: CommentStore;
	readonly path: string;

	constructor(config: ServerCommentsConfig<E>) {
		this.config = config;
		this.path = config.path.replace(/\/$/, '');
	}

	private get database() {
		return this.config.database === ':memory:' ? ':memory:' : resolve(this.config.database);
	}

	/** Opened on first use so builds and prerendering never touch the database. */
	get store(): CommentStore {
		if (this.database === ':memory:') return (this.memory ??= new CommentStore(':memory:'));
		const open = stores.get(this.path);
		if (!open) {
			const store = new CommentStore(this.database);
			stores.set(this.path, { database: this.database, store });
			// Closing checkpoints the WAL, so a stopped server leaves all its
			// comments in the one database file, not in comments.sqlite-wal.
			process.once('exit', () => {
				if (stores.get(this.path)?.store === store) store.close();
			});
			return store;
		}
		if (open.database !== this.database) {
			throw new CommentError(
				503,
				`The comment database changed from ${open.database} to ${this.database} while the server was running. Restart the server.`
			);
		}
		return open.store;
	}

	close() {
		this.memory?.close();
		this.memory = undefined;
		const open = stores.get(this.path);
		if (open?.database === this.database) {
			open.store.close();
			stores.delete(this.path);
		}
	}

	private async viewer(event: E): Promise<CommentAuthor | null> {
		const user = await this.config.user(event);
		const sub = text(user?.sub, 255);
		if (!user || !sub) return null;
		const picture = text(user.picture, 2048);
		return {
			sub,
			name: text(user.name, 200) ?? 'Account',
			...(picture && /^https:\/\//.test(picture) ? { picture } : {})
		};
	}

	private async input(request: Request): Promise<Record<string, unknown>> {
		if (!request.headers.get('content-type')?.includes('application/json')) {
			throw new CommentError(415, 'Send JSON.');
		}
		const raw = await request.text();
		if (raw.length > MAX_REQUEST) throw new CommentError(413, 'Request too large.');
		try {
			const value = JSON.parse(raw);
			if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
		} catch { /* fall through */ }
		throw new CommentError(400, 'Invalid request.');
	}

	/** Returns undefined for requests outside `path`. */
	async handle(event: E): Promise<Response | undefined> {
		const { request, url } = event;
		if (url.pathname !== this.path && !url.pathname.startsWith(`${this.path}/`)) return undefined;
		const route = url.pathname.slice(this.path.length).replace(/\/$/, '');
		const method = request.method;
		try {
			if (method !== 'GET' && request.headers.get('origin') !== url.origin) {
				return fail(403, 'Invalid request origin.');
			}
			const viewer = await this.viewer(event);
			let match: RegExpMatchArray | null;
			if (method === 'GET' && route === '') {
				const snapshot: CommentsSnapshot = {
					viewer,
					threads: viewer || this.config.public ? this.store.list(viewer?.sub ?? null) : []
				};
				return json(snapshot);
			}
			if (method === 'GET' && route === '/events') {
				if (!viewer && !this.config.public) return fail(401, 'Sign in to see comments.');
				return this.events(request);
			}
			if (method === 'GET' && (match = route.match(/^\/images\/(\d+)$/))) {
				if (!viewer && !this.config.public) return fail(401, 'Sign in to see comments.');
				const image = this.store.image(Number(match[1]), viewer?.sub ?? null);
				return new Response(image.data as Uint8Array<ArrayBuffer>, {
					headers: {
						'Content-Type': image.type,
						// An image's id is never reused, so its bytes never change.
						'Cache-Control': 'private, max-age=31536000, immutable',
						'X-Content-Type-Options': 'nosniff',
						'Content-Security-Policy': "default-src 'none'; sandbox"
					}
				});
			}
			if (!viewer) return fail(401, 'Sign in to comment.');

			if (route === '/images' && method === 'POST') return json({ image: await this.upload(request, url, viewer) }, 201);
			if (route === '/threads' && method === 'POST') {
				const input = await this.input(request);
				const frame = text(input.frame, 128);
				if (!frame || !FRAME_ID.test(frame)) throw new CommentError(400, 'Unknown frame.');
				const images = imageIds(input.images);
				const thread = this.store.createThread(viewer, {
					frame, x: coordinate(input.x), y: coordinate(input.y), anchor: anchor(input.anchor),
					body: body(input.body, images.length > 0), images
				});
				return json({ thread }, 201);
			}
			if ((match = route.match(/^\/threads\/(\d+)$/))) {
				const id = Number(match[1]);
				if (method === 'PATCH') {
					const input = await this.input(request);
					if (typeof input.resolved !== 'boolean') throw new CommentError(400, 'Invalid request.');
					return json({ thread: this.store.resolve(viewer, id, input.resolved) });
				}
				if (method === 'DELETE') {
					this.store.deleteThread(viewer, id);
					return json({ deleted: id });
				}
			}
			if ((match = route.match(/^\/threads\/(\d+)\/comments$/)) && method === 'POST') {
				const input = await this.input(request);
				const images = imageIds(input.images);
				return json({ thread: this.store.reply(viewer, Number(match[1]), body(input.body, images.length > 0), images) }, 201);
			}
			if ((match = route.match(/^\/threads\/(\d+)\/read$/)) && method === 'POST') {
				const input = await this.input(request);
				if (typeof input.read !== 'boolean') throw new CommentError(400, 'Invalid request.');
				return json({ thread: this.store.markRead(viewer, Number(match[1]), input.read) });
			}
			if ((match = route.match(/^\/comments\/(\d+)$/))) {
				const id = Number(match[1]);
				if (method === 'PATCH') {
					const input = await this.input(request);
					// The store checks that a comment left without text still has an image.
					const images = input.images === undefined ? undefined : imageIds(input.images);
					return json({ thread: this.store.editComment(viewer, id, body(input.body, true), images) });
				}
				if (method === 'DELETE') {
					const thread = this.store.deleteComment(viewer, id);
					return json(thread ? { thread } : { deleted: id });
				}
			}
			return fail(404, 'Not found.');
		} catch (error) {
			if (error instanceof CommentError) return fail(error.status, error.message);
			console.error('[paraframe] Comment request failed', error);
			return fail(500, 'Something went wrong. Try again.');
		}
	}

	/** An image sent as the raw request body, with `?width=&height=` measured by the browser. */
	private async upload(request: Request, url: URL, viewer: CommentAuthor) {
		const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
		const matches = IMAGE_SIGNATURES[type];
		if (!matches) throw new CommentError(415, 'Images must be PNG, JPEG, GIF or WebP.');
		const tooLarge = `Images are limited to ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`;
		if (Number(request.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new CommentError(413, tooLarge);
		const data = new Uint8Array(await request.arrayBuffer());
		if (data.length > MAX_IMAGE_BYTES) throw new CommentError(413, tooLarge);
		if (!matches(data)) throw new CommentError(415, 'This file is not the image it claims to be.');
		return this.store.addImage(viewer, {
			type, width: side(url.searchParams.get('width')), height: side(url.searchParams.get('height')), data
		});
	}

	/** Server-sent events: a `change` event after any write, so clients refetch. */
	private events(request: Request): Response {
		const encoder = new TextEncoder();
		const store = this.store;
		let cleanup = () => {};
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const send = (chunk: string) => {
					try { controller.enqueue(encoder.encode(chunk)); } catch { cleanup(); }
				};
				const onchange = () => send('event: change\ndata: {}\n\n');
				const keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS);
				store.events.addEventListener('change', onchange);
				cleanup = () => {
					clearInterval(keepalive);
					store.events.removeEventListener('change', onchange);
				};
				request.signal.addEventListener('abort', () => {
					cleanup();
					try { controller.close(); } catch { /* already closed */ }
				});
				send('retry: 3000\n\n');
			},
			cancel() {
				cleanup();
			}
		});
		return new Response(stream, {
			headers: { ...noStore, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' }
		});
	}
}
