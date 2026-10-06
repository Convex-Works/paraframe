import { CommentError, CommentStore } from './comment-store.js';
import type { CommentAuthor, CommentsSnapshot } from '../comments.js';

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
const MAX_REQUEST = 32 * 1024;
const FRAME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEEPALIVE_MS = 25_000;
const noStore = { 'Cache-Control': 'no-store' };

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: noStore });
const fail = (status: number, error: string) => json({ error }, status);

function text(value: unknown, max: number): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function body(value: unknown): string {
	if (typeof value !== 'string') throw new CommentError(400, 'A comment needs some text.');
	const normalized = value.replace(/\r\n?/g, '\n').trim();
	if (!normalized) throw new CommentError(400, 'A comment needs some text.');
	if (normalized.length > MAX_BODY) throw new CommentError(413, `Comments are limited to ${MAX_BODY} characters.`);
	return normalized;
}

function coordinate(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000) {
		throw new CommentError(400, 'Invalid comment position.');
	}
	return Math.round(value * 10) / 10;
}

/** Server-only comment endpoints backed by SQLite. Import from paraframe/server. */
export class ServerComments<E extends CommentsRequest = CommentsRequest> {
	private config: ServerCommentsConfig<E>;
	private opened?: CommentStore;
	readonly path: string;

	constructor(config: ServerCommentsConfig<E>) {
		this.config = config;
		this.path = config.path.replace(/\/$/, '');
	}

	/** Opened on first use so builds and prerendering never touch the database. */
	get store(): CommentStore {
		this.opened ??= new CommentStore(this.config.database);
		return this.opened;
	}

	close() {
		this.opened?.close();
		this.opened = undefined;
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
			if (!viewer) return fail(401, 'Sign in to comment.');

			let match: RegExpMatchArray | null;
			if (route === '/threads' && method === 'POST') {
				const input = await this.input(request);
				const frame = text(input.frame, 128);
				if (!frame || !FRAME_ID.test(frame)) throw new CommentError(400, 'Unknown frame.');
				const thread = this.store.createThread(viewer, {
					frame, x: coordinate(input.x), y: coordinate(input.y), body: body(input.body)
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
				return json({ thread: this.store.reply(viewer, Number(match[1]), body(input.body)) }, 201);
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
					return json({ thread: this.store.editComment(viewer, id, body(input.body)) });
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
