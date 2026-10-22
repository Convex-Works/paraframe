// The comment server for the published showcase, which has none: this worker
// answers visual-comments' requests and its sign-in at the paths in
// src/demo/comments.ts, and keeps the threads and images in this browser's
// Cache Storage. Each visitor sees only their own comments. Every other request
// goes to the network as usual. See src/demo/comments.ts.
import { self } from '$app/service-worker';
import type { Comment, CommentImage, CommentThread, CommentsSnapshot, NewThreadInput, Viewer } from 'visual-comments';
import { demoComments } from '../demo/comments.js';

const { endpoint, auth } = demoComments;
const CACHE = 'paraframe-demo-comments';
const STATE = `${endpoint}/state`;
/** The visitor, signed in until they sign out. Nobody else writes here. */
const VISITOR: Viewer = { sub: 'visitor', name: 'You' };
// As on visual-comments' server: no SVG, which can carry script.
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface State {
	signedIn: boolean;
	threads: CommentThread[];
	/** Images uploaded for a comment that has not been sent yet. */
	uploads: CommentImage[];
	/** The last thread, comment and image ids given out, so none is reused. */
	last: { thread: number; comment: number; image: number };
}

class Refused extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
// A page opened by a hard reload is not controlled until it asks.
self.addEventListener('message', (event) => {
	if (event.data === 'claim') event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;
	if (under(url, endpoint)) event.respondWith(serially(() => comments(event.request, url)));
	else if (under(url, auth)) event.respondWith(serially(() => signIn(event.request, url)));
});

const under = (url: URL, path: string) => url.pathname === path || url.pathname.startsWith(`${path}/`);

// One request at a time, so each reads the state the last one wrote.
let queue: Promise<unknown> = Promise.resolve();
function serially(task: () => Promise<Response>): Promise<Response> {
	const run = queue.then(task);
	queue = run.catch(() => {});
	return run;
}

let state: State | undefined;

/** The stored state, or a fresh one: signed in, with no threads. */
async function load(): Promise<State> {
	state ??= await (await caches.open(CACHE)).match(STATE)
		.then((response) => response?.json() as Promise<State> | undefined)
		.catch(() => undefined)
		?? { signedIn: true, threads: [], uploads: [], last: { thread: 0, comment: 0, image: 0 } };
	return state;
}

async function save() {
	await (await caches.open(CACHE)).put(STATE, Response.json(state));
}

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/** The sign-in only switches between the visitor and nobody. */
async function signIn(request: Request, url: URL): Promise<Response> {
	const current = await load();
	const route = url.pathname.slice(auth.length);
	if (route === '/login') {
		current.signedIn = true;
		await save();
		return back(url.searchParams.get('returnTo'));
	}
	if (route === '/logout' && request.method === 'POST') {
		current.signedIn = false;
		await save();
		return back(request.referrer && new URL(request.referrer).origin === self.location.origin ? new URL(request.referrer).pathname : '/');
	}
	return json({ error: 'Not found.' }, 404);
}

/** A redirect to a path on this site only. */
function back(path: string | null) {
	const safe = path?.startsWith('/') && !path.startsWith('//') ? path : '/';
	return Response.redirect(new URL(safe, self.location.origin).href, 303);
}

async function comments(request: Request, url: URL): Promise<Response> {
	const route = url.pathname.slice(endpoint.length).replace(/\/$/, '');
	const method = request.method;
	try {
		const current = await load();
		if (method === 'GET' && route === '') {
			const snapshot: CommentsSnapshot = {
				space: { id: 'showcase', name: 'this browser' },
				viewer: current.signedIn ? VISITOR : null,
				threads: current.signedIn ? current.threads : []
			};
			return json(snapshot);
		}
		if (!current.signedIn) throw new Refused(401, 'Sign in to see comments.');
		// No live updates: there is nobody else. Other tabs catch up when they get focus.
		if (method === 'GET' && route === '/events') return new Response(null, { status: 204 });
		if (method === 'GET' && route.startsWith('/images/')) {
			return (await (await caches.open(CACHE)).match(url.href)) ?? json({ error: 'This image no longer exists.' }, 404);
		}
		if (method === 'POST' && route === '/images') return json({ image: await upload(current, request, url) }, 201);

		let match: RegExpMatchArray | null;
		let result: { thread?: CommentThread; deleted?: number };
		if (method === 'POST' && route === '/threads') {
			result = { thread: create(current, await request.json()) };
		} else if ((match = route.match(/^\/threads\/(\d+)$/)) && (method === 'PATCH' || method === 'DELETE')) {
			const thread = threadOf(current, Number(match[1]));
			if (method === 'PATCH') {
				const { resolved } = await request.json();
				thread.resolvedAt = resolved ? Date.now() : null;
				thread.resolvedBy = resolved ? VISITOR : null;
				result = { thread };
			} else {
				await removeThread(current, thread);
				result = { deleted: thread.id };
			}
		} else if ((match = route.match(/^\/threads\/(\d+)\/comments$/)) && method === 'POST') {
			const thread = threadOf(current, Number(match[1]));
			const input = await request.json();
			const images = take(current, input.images);
			thread.comments.push(comment(current, text(input.body, images.length > 0), images));
			// Replying to a resolved thread reopens it.
			thread.resolvedAt = null;
			thread.resolvedBy = null;
			result = { thread };
		} else if ((match = route.match(/^\/threads\/(\d+)\/read$/)) && method === 'POST') {
			result = { thread: threadOf(current, Number(match[1])) };
		} else if ((match = route.match(/^\/comments\/(\d+)$/)) && (method === 'PATCH' || method === 'DELETE')) {
			const id = Number(match[1]);
			const thread = current.threads.find((t) => t.comments.some((c) => c.id === id));
			if (!thread) throw new Refused(404, 'This comment no longer exists.');
			const index = thread.comments.findIndex((c) => c.id === id);
			if (method === 'PATCH') {
				const input = await request.json();
				const old = thread.comments[index];
				const images = input.images === undefined ? old.images : take(current, input.images, old.images);
				await forget(old.images.filter((image) => !images.includes(image)));
				thread.comments[index] = { ...old, body: text(input.body, images.length > 0), images, editedAt: Date.now() };
				result = { thread };
			} else if (index === 0) {
				// Deleting the first comment deletes the thread.
				await removeThread(current, thread);
				result = { deleted: thread.id };
			} else {
				await forget(thread.comments[index].images);
				thread.comments.splice(index, 1);
				result = { thread };
			}
		} else {
			throw new Refused(404, 'Not found.');
		}
		await save();
		const created = method === 'POST' && (route === '/threads' || route.endsWith('/comments'));
		return json(result, created ? 201 : 200);
	} catch (error) {
		if (error instanceof Refused) return json({ error: error.message }, error.status);
		return json({ error: 'Something went wrong. Try again.' }, 500);
	}
}

function create(current: State, input: NewThreadInput): CommentThread {
	const images = take(current, input.images);
	const url = new URL(input.url);
	url.hash = '';
	const thread: CommentThread = {
		id: ++current.last.thread,
		page: input.page,
		url: url.href,
		surface: input.surface ?? '',
		title: input.title ?? '',
		x: input.x,
		y: input.y,
		anchor: input.anchor ?? null,
		context: input.context ?? {},
		createdAt: Date.now(),
		resolvedAt: null,
		resolvedBy: null,
		unread: false,
		comments: [comment(current, text(input.body, images.length > 0), images)]
	};
	current.threads.push(thread);
	return thread;
}

function comment(current: State, body: string, images: CommentImage[]): Comment {
	return { id: ++current.last.comment, author: VISITOR, body, images, createdAt: Date.now(), editedAt: null };
}

function threadOf(current: State, id: number): CommentThread {
	const thread = current.threads.find((t) => t.id === id);
	if (!thread) throw new Refused(404, 'This comment no longer exists.');
	return thread;
}

async function removeThread(current: State, thread: CommentThread) {
	current.threads = current.threads.filter((t) => t !== thread);
	await forget(thread.comments.flatMap((c) => c.images));
}

/** A comment's text, which may be empty only when it has images. */
function text(value: unknown, optional: boolean): string {
	const body = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
	if (!body && !optional) throw new Refused(400, 'A comment needs some text or an image.');
	return body;
}

/** The images with these ids, from the comment's own (`kept`) or from new uploads, which it then owns. */
function take(current: State, ids: unknown, kept: CommentImage[] = []): CommentImage[] {
	if (ids === undefined) return [];
	if (!Array.isArray(ids)) throw new Refused(400, 'Invalid images.');
	return ids.map((id) => {
		const image = kept.find((i) => i.id === id) ?? current.uploads.find((i) => i.id === id);
		if (!image) throw new Refused(400, 'An image could not be attached. Add it again.');
		current.uploads = current.uploads.filter((i) => i !== image);
		return image;
	});
}

/** Stores an image, sent as the request body, before its comment is sent. */
async function upload(current: State, request: Request, url: URL): Promise<CommentImage> {
	const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
	if (!IMAGE_TYPES.includes(type)) throw new Refused(415, 'Images must be PNG, JPEG, GIF or WebP.');
	const data = await request.arrayBuffer();
	if (data.byteLength > MAX_IMAGE_BYTES) throw new Refused(413, 'Images are limited to 10 MB.');
	const image: CommentImage = {
		id: ++current.last.image,
		key: crypto.randomUUID(),
		width: Number(url.searchParams.get('width')) || 1,
		height: Number(url.searchParams.get('height')) || 1
	};
	await (await caches.open(CACHE)).put(imageUrl(image), new Response(data, {
		headers: { 'Content-Type': type, 'Content-Security-Policy': "default-src 'none'; sandbox" }
	}));
	current.uploads.push(image);
	await save();
	return image;
}

const imageUrl = (image: CommentImage) => new URL(`${endpoint}/images/${image.id}/${image.key}`, self.location.origin).href;

async function forget(images: CommentImage[]) {
	const cache = await caches.open(CACHE);
	await Promise.all(images.map((image) => cache.delete(imageUrl(image))));
}
