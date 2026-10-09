import type { Comment, CommentAnchor, CommentAuthor, CommentFilters, CommentImage, CommentThread, CommentsSnapshot } from '../comments.js';

type Result = { thread?: CommentThread; deleted?: number };

/**
 * Comment threads from the host's comment endpoints, kept current with
 * server-sent events, plus the viewer's comment mode. Lives in the viewer
 * layout so it survives moving between the canvas and the player.
 */
export class CommentsClient {
	viewer = $state<CommentAuthor | null>(null);
	threads = $state<CommentThread[]>([]);
	loading = $state(true);
	/** A failed action, shown until dismissed. */
	error = $state<string | null>(null);
	/** Ticks every 30 seconds so relative times stay current. */
	now = $state(Date.now());

	/** Comment mode: the comments panel is shown, and clicking a frame starts a thread. Pins always show. */
	active = $state(false);
	/** The thread whose conversation is open. */
	openId = $state<number | undefined>();
	filters = $state<CommentFilters>({ query: '', sort: 'date', showResolved: false, onlyMine: false });

	readonly path: string;
	private source?: EventSource;
	private refreshing?: Promise<void>;
	private queued = false;
	private timers: ReturnType<typeof setInterval>[] = [];
	private nextPending = -1;

	constructor(path: string) {
		this.path = path.replace(/\/$/, '');
	}

	get open(): CommentThread | undefined {
		return this.threads.find((thread) => thread.id === this.openId);
	}

	get unreadCount(): number {
		return this.threads.filter((thread) => thread.unread && !thread.resolvedAt).length;
	}

	/** Threads shown as pins: unresolved, unless resolved threads are shown or the thread is open. */
	get pinned(): CommentThread[] {
		return this.threads.filter((thread) =>
			!thread.resolvedAt || this.filters.showResolved || thread.id === this.openId);
	}

	start() {
		void this.refresh();
		const onfocus = () => { void this.refresh(); };
		window.addEventListener('focus', onfocus);
		this.timers.push(setInterval(() => { this.now = Date.now(); }, 30_000));
		return () => {
			window.removeEventListener('focus', onfocus);
			for (const timer of this.timers) clearInterval(timer);
			this.source?.close();
			this.source = undefined;
		};
	}

	/** Coalesces overlapping refreshes into at most one more request. */
	refresh(): Promise<void> {
		if (this.refreshing) {
			this.queued = true;
			return this.refreshing;
		}
		this.refreshing = (async () => {
			try {
				const response = await fetch(this.path, { credentials: 'same-origin', cache: 'no-store' });
				if (!response.ok) throw new Error();
				const snapshot = (await response.json()) as CommentsSnapshot;
				this.viewer = snapshot.viewer;
				// Keep replies that are still on their way to the server.
				const pending = new Map(this.threads.map((t) => [t.id, t.comments.filter((c) => c.pending)]));
				this.threads = snapshot.threads.map((thread) => {
					const waiting = pending.get(thread.id);
					return waiting?.length ? { ...thread, comments: [...thread.comments, ...waiting] } : thread;
				});
				if (this.openId !== undefined && !this.open) this.openId = undefined;
				this.listen();
			} catch {
				// Keep what is shown; the next event or focus retries.
			} finally {
				this.loading = false;
				this.refreshing = undefined;
				if (this.queued) {
					this.queued = false;
					void this.refresh();
				}
			}
		})();
		return this.refreshing;
	}

	private listen() {
		if (!this.viewer || this.source || typeof EventSource === 'undefined') return;
		let opened = false;
		const source = new EventSource(`${this.path}/events`);
		source.addEventListener('change', () => { void this.refresh(); });
		// After a dropped connection, catch up on anything missed.
		source.addEventListener('open', () => {
			if (opened) void this.refresh();
			opened = true;
		});
		source.addEventListener('error', () => {
			if (source.readyState === EventSource.CLOSED && this.source === source) this.source = undefined;
		});
		this.source = source;
	}

	private async request(method: string, path: string, body?: unknown): Promise<Result> {
		const response = await fetch(`${this.path}${path}`, {
			method,
			credentials: 'same-origin',
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(result.error ?? 'Something went wrong. Try again.');
		}
		return result as Result;
	}

	private apply(result: Result) {
		if (result.thread) {
			const thread = result.thread;
			const index = this.threads.findIndex((t) => t.id === thread.id);
			if (index === -1) this.threads.push(thread);
			else this.threads[index] = thread;
		}
		if (result.deleted !== undefined) {
			this.threads = this.threads.filter((t) => t.id !== result.deleted);
			if (this.openId === result.deleted) this.openId = undefined;
		}
	}

	/** Runs an action, showing its error and resyncing with the server if it fails. */
	private async run(action: () => Promise<Result>, rethrow = false) {
		try {
			this.apply(await action());
		} catch (error) {
			this.error = (error as Error).message;
			void this.refresh();
			if (rethrow) throw error;
		}
	}

	private update(id: number, change: (thread: CommentThread) => CommentThread) {
		const index = this.threads.findIndex((t) => t.id === id);
		if (index !== -1) this.threads[index] = change(this.threads[index]);
	}

	openThread(id: number | undefined) {
		this.openId = id;
		const thread = this.open;
		if (thread?.unread) void this.markRead(thread.id, true);
	}

	imageUrl(image: CommentImage) {
		return `${this.path}/images/${image.id}`;
	}

	/** Uploads an image for a comment being written. Send its id with the comment. */
	async upload(file: Blob, width: number, height: number): Promise<CommentImage> {
		const response = await fetch(`${this.path}/images?width=${width}&height=${height}`, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': file.type },
			body: file
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(result.error ?? (response.status === 413 ? 'This image is too large.' : 'The image could not be uploaded.'));
		}
		return result.image as CommentImage;
	}

	async create(frame: string, x: number, y: number, body: string, anchor?: CommentAnchor, images: CommentImage[] = []): Promise<CommentThread> {
		const { thread } = await this.request('POST', '/threads', { frame, x, y, anchor, body, images: images.map((i) => i.id) });
		this.apply({ thread });
		return thread!;
	}

	/** Shows the reply at once; throws if it could not be sent. */
	async reply(threadId: number, body: string, images: CommentImage[] = []) {
		const pending: Comment = {
			id: this.nextPending--, author: this.viewer!, body, images, createdAt: Date.now(), editedAt: null, pending: true
		};
		this.update(threadId, (t) => ({ ...t, resolvedAt: null, resolvedBy: null, comments: [...t.comments, pending] }));
		try {
			await this.run(() => this.request('POST', `/threads/${threadId}/comments`, { body, images: images.map((i) => i.id) }), true);
		} finally {
			this.update(threadId, (t) => ({ ...t, comments: t.comments.filter((c) => c.id !== pending.id) }));
		}
	}

	async edit(commentId: number, body: string, images: CommentImage[]) {
		await this.run(() => this.request('PATCH', `/comments/${commentId}`, { body, images: images.map((i) => i.id) }), true);
	}

	async removeComment(commentId: number) {
		await this.run(() => this.request('DELETE', `/comments/${commentId}`));
	}

	async removeThread(threadId: number) {
		this.threads = this.threads.filter((t) => t.id !== threadId);
		if (this.openId === threadId) this.openId = undefined;
		await this.run(() => this.request('DELETE', `/threads/${threadId}`));
	}

	async resolve(threadId: number, resolved: boolean) {
		this.update(threadId, (t) => ({
			...t, resolvedAt: resolved ? Date.now() : null, resolvedBy: resolved ? this.viewer : null
		}));
		await this.run(() => this.request('PATCH', `/threads/${threadId}`, { resolved }));
	}

	async markRead(threadId: number, read: boolean) {
		this.update(threadId, (t) => ({ ...t, unread: !read && t.comments.some((c) => c.author.sub !== this.viewer?.sub) }));
		await this.run(() => this.request('POST', `/threads/${threadId}/read`, { read }));
	}

	async markAllRead() {
		await Promise.all(this.threads.filter((t) => t.unread).map((t) => this.markRead(t.id, true)));
	}
}
