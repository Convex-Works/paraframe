import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Comment, CommentAnchor, CommentAuthor, CommentImage, CommentThread } from '../comments.js';

/** A request the store refused, with the HTTP status the handler should send. */
export class CommentError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export interface NewThread {
	frame: string;
	x: number;
	y: number;
	anchor: CommentAnchor | null;
	body: string;
	images: number[];
}

export interface NewImage {
	type: string;
	width: number;
	height: number;
	data: Uint8Array;
}

/** Images uploaded but never sent with a comment are dropped after this long. */
const UNSENT_IMAGE_MS = 24 * 60 * 60 * 1000;

type Row = Record<string, string | number | null>;

const SCHEMA = [
	`CREATE TABLE users (
		sub TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		picture TEXT,
		seen_at INTEGER NOT NULL
	)`,
	// AUTOINCREMENT so a deleted thread's number is never given to another.
	`CREATE TABLE threads (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		frame TEXT NOT NULL,
		x REAL NOT NULL,
		y REAL NOT NULL,
		author TEXT NOT NULL REFERENCES users(sub),
		created_at INTEGER NOT NULL,
		resolved_at INTEGER,
		resolved_by TEXT REFERENCES users(sub)
	)`,
	`CREATE TABLE comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		thread INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
		author TEXT NOT NULL REFERENCES users(sub),
		body TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		edited_at INTEGER
	)`,
	`CREATE INDEX comments_by_thread ON comments(thread, id)`,
	// The newest comment each person has seen in a thread.
	`CREATE TABLE reads (
		thread INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
		user TEXT NOT NULL REFERENCES users(sub),
		comment INTEGER NOT NULL,
		PRIMARY KEY (thread, user)
	) WITHOUT ROWID`
];

// Each entry moves the database up one version (PRAGMA user_version).
const MIGRATIONS: string[][] = [
	SCHEMA,
	// The element under the pin, as JSON.
	['ALTER TABLE threads ADD COLUMN anchor TEXT'],
	// Images in comments. They upload while the comment is written, so `comment` starts empty.
	[
		`CREATE TABLE images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			comment INTEGER REFERENCES comments(id) ON DELETE CASCADE,
			author TEXT NOT NULL REFERENCES users(sub),
			type TEXT NOT NULL,
			width INTEGER NOT NULL,
			height INTEGER NOT NULL,
			data BLOB NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX images_by_comment ON images(comment, id)`
	]
];

/** Comment threads in one SQLite file. Synchronous: each call is atomic in a Node process. */
export class CommentStore {
	/** Dispatches `change` after every write. */
	readonly events = new EventTarget();
	private db: DatabaseSync;
	private filename: string;
	/** The file this store opened, to notice when it is deleted or replaced. */
	private identity?: { dev: number; ino: number };

	constructor(filename: string) {
		this.filename = filename;
		if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
		this.db = new DatabaseSync(filename);
		if (filename !== ':memory:') {
			const { dev, ino } = statSync(filename);
			this.identity = { dev, ino };
		}
		this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
		const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
		if (version < MIGRATIONS.length) this.transaction(() => {
			for (const statements of MIGRATIONS.slice(version)) for (const statement of statements) this.db.exec(statement);
			this.db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
		});
	}

	close() {
		this.db.close();
	}

	/**
	 * SQLite keeps reading and writing a database file that was deleted or
	 * replaced while open, and those writes are lost. Refuse instead.
	 */
	private ensureSameFile() {
		if (!this.identity) return;
		let now: { dev: number; ino: number } | undefined;
		try {
			now = statSync(this.filename);
		} catch {
			// Deleted.
		}
		if (now?.dev !== this.identity.dev || now?.ino !== this.identity.ino) {
			throw new CommentError(
				503,
				`The comment database ${this.filename} was deleted or replaced while the server was running. Restart the server.`
			);
		}
	}

	private transaction<T>(run: () => T): T {
		this.ensureSameFile();
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const result = run();
			this.db.exec('COMMIT');
			return result;
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}

	private changed() {
		this.events.dispatchEvent(new Event('change'));
	}

	private saveUser(user: CommentAuthor, now: number) {
		this.db.prepare(`INSERT INTO users (sub, name, picture, seen_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (sub) DO UPDATE SET name = excluded.name, picture = excluded.picture, seen_at = excluded.seen_at`)
			.run(user.sub, user.name, user.picture ?? null, now);
	}

	private markReadUpTo(thread: number, user: string, comment: number) {
		this.db.prepare(`INSERT INTO reads (thread, user, comment) VALUES (?, ?, ?)
			ON CONFLICT (thread, user) DO UPDATE SET comment = max(comment, excluded.comment)`)
			.run(thread, user, comment);
	}

	private addComment(thread: number, user: string, body: string, images: number[], now: number) {
		const { lastInsertRowid } = this.db.prepare(
			'INSERT INTO comments (thread, author, body, created_at) VALUES (?, ?, ?, ?)'
		).run(thread, user, body, now);
		const id = Number(lastInsertRowid);
		this.setImages(id, user, images);
		this.markReadUpTo(thread, user, id);
	}

	/** Makes `ids` the comment's images: drops the ones left out, attaches the viewer's new uploads. */
	private setImages(comment: number, user: string, ids: number[]) {
		this.db.prepare('DELETE FROM images WHERE comment = ? AND id NOT IN (SELECT value FROM json_each(?))')
			.run(comment, JSON.stringify(ids));
		const attach = this.db.prepare(
			'UPDATE images SET comment = ? WHERE id = ? AND author = ? AND (comment IS NULL OR comment = ?)'
		);
		for (const id of ids) {
			if (!attach.run(comment, id, user, comment).changes) {
				throw new CommentError(400, 'An image could not be attached. Add it again.');
			}
		}
	}

	/** Stores an image before its comment is sent. */
	addImage(user: CommentAuthor, image: NewImage): CommentImage {
		const now = Date.now();
		const id = this.transaction(() => {
			this.saveUser(user, now);
			this.db.prepare('DELETE FROM images WHERE comment IS NULL AND created_at < ?').run(now - UNSENT_IMAGE_MS);
			const { lastInsertRowid } = this.db.prepare(
				'INSERT INTO images (author, type, width, height, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
			).run(user.sub, image.type, image.width, image.height, image.data, now);
			return Number(lastInsertRowid);
		});
		return { id, width: image.width, height: image.height };
	}

	/** An image in a comment, or the viewer's own upload not yet sent. */
	image(id: number, viewer: string | null): { type: string; data: Uint8Array } {
		this.ensureSameFile();
		const row = this.db.prepare('SELECT type, data, comment, author FROM images WHERE id = ?').get(id) as
			| { type: string; data: Uint8Array; comment: number | null; author: string }
			| undefined;
		if (!row || (row.comment === null && row.author !== viewer)) throw new CommentError(404, 'This image no longer exists.');
		return { type: row.type, data: row.data };
	}

	/** Every thread with its comments, oldest first, as seen by the viewer. */
	list(viewer: string | null): CommentThread[] {
		return this.load(viewer);
	}

	thread(id: number, viewer: string | null): CommentThread {
		const thread = this.load(viewer, id)[0];
		if (!thread) throw new CommentError(404, 'This comment no longer exists.');
		return thread;
	}

	private load(viewer: string | null, only?: number): CommentThread[] {
		this.ensureSameFile();
		const where = only === undefined ? '' : 'WHERE t.id = ?';
		const params = only === undefined ? [] : [only];
		const users = new Map<string, CommentAuthor>();
		for (const row of this.db.prepare('SELECT sub, name, picture FROM users').all() as Row[]) {
			users.set(row.sub as string, {
				sub: row.sub as string,
				name: row.name as string,
				...(row.picture ? { picture: row.picture as string } : {})
			});
		}
		const author = (sub: string) => users.get(sub) ?? { sub, name: 'Unknown' };

		const threads = new Map<number, CommentThread & { readUpTo: number }>();
		const threadRows = this.db.prepare(`SELECT t.*, r.comment AS read_up_to FROM threads t
			LEFT JOIN reads r ON r.thread = t.id AND r.user = ? ${where} ORDER BY t.id`)
			.all(viewer, ...params) as Row[];
		for (const row of threadRows) {
			threads.set(row.id as number, {
				id: row.id as number,
				frame: row.frame as string,
				x: row.x as number,
				y: row.y as number,
				anchor: row.anchor ? JSON.parse(row.anchor as string) as CommentAnchor : null,
				createdAt: row.created_at as number,
				resolvedAt: row.resolved_at as number | null,
				resolvedBy: row.resolved_by ? author(row.resolved_by as string) : null,
				unread: false,
				comments: [],
				readUpTo: (row.read_up_to as number | null) ?? 0
			});
		}
		const commentRows = this.db.prepare(`SELECT c.* FROM comments c
			${only === undefined ? '' : 'WHERE c.thread = ?'} ORDER BY c.id`).all(...params) as Row[];
		const byId = new Map<number, Comment>();
		for (const row of commentRows) {
			const thread = threads.get(row.thread as number);
			if (!thread) continue;
			const comment: Comment = {
				id: row.id as number,
				author: author(row.author as string),
				body: row.body as string,
				images: [],
				createdAt: row.created_at as number,
				editedAt: row.edited_at as number | null
			};
			thread.comments.push(comment);
			byId.set(comment.id, comment);
			if (viewer && comment.author.sub !== viewer && comment.id > thread.readUpTo) thread.unread = true;
		}
		const imageRows = this.db.prepare(`SELECT i.id, i.comment, i.width, i.height FROM images i
			JOIN comments c ON c.id = i.comment ${only === undefined ? '' : 'WHERE c.thread = ?'} ORDER BY i.id`)
			.all(...params) as Row[];
		for (const row of imageRows) {
			byId.get(row.comment as number)?.images.push({
				id: row.id as number, width: row.width as number, height: row.height as number
			});
		}
		return [...threads.values()]
			.filter((thread) => thread.comments.length)
			.map(({ readUpTo: _, ...thread }) => thread);
	}

	createThread(user: CommentAuthor, input: NewThread): CommentThread {
		const now = Date.now();
		const id = this.transaction(() => {
			this.saveUser(user, now);
			const { lastInsertRowid } = this.db.prepare(
				'INSERT INTO threads (frame, x, y, anchor, author, created_at) VALUES (?, ?, ?, ?, ?, ?)'
			).run(input.frame, input.x, input.y, input.anchor && JSON.stringify(input.anchor), user.sub, now);
			const id = Number(lastInsertRowid);
			this.addComment(id, user.sub, input.body, input.images, now);
			return id;
		});
		this.changed();
		return this.thread(id, user.sub);
	}

	reply(user: CommentAuthor, threadId: number, body: string, images: number[] = []): CommentThread {
		const now = Date.now();
		this.transaction(() => {
			this.requireThread(threadId);
			this.saveUser(user, now);
			this.addComment(threadId, user.sub, body, images, now);
			// Replying to a resolved thread reopens it.
			this.db.prepare('UPDATE threads SET resolved_at = NULL, resolved_by = NULL WHERE id = ?').run(threadId);
		});
		this.changed();
		return this.thread(threadId, user.sub);
	}

	/** Leaves the images as they are when `images` is undefined. */
	editComment(user: CommentAuthor, commentId: number, body: string, images?: number[]): CommentThread {
		const comment = this.requireOwnComment(user, commentId);
		this.transaction(() => {
			this.saveUser(user, Date.now());
			if (images) this.setImages(commentId, user.sub, images);
			const { count } = this.db.prepare('SELECT count(*) AS count FROM images WHERE comment = ?').get(commentId) as { count: number };
			if (!body && !count) throw new CommentError(400, 'A comment needs some text or an image.');
			this.db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body, Date.now(), commentId);
		});
		this.changed();
		return this.thread(comment.thread, user.sub);
	}

	/** Deleting a thread's first comment deletes the thread. Returns the thread, or null if deleted. */
	deleteComment(user: CommentAuthor, commentId: number): CommentThread | null {
		const comment = this.requireOwnComment(user, commentId);
		const first = this.db.prepare('SELECT min(id) AS id FROM comments WHERE thread = ?').get(comment.thread) as { id: number };
		if (first.id === commentId) {
			this.db.prepare('DELETE FROM threads WHERE id = ?').run(comment.thread);
			this.changed();
			return null;
		}
		this.db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
		this.changed();
		return this.thread(comment.thread, user.sub);
	}

	deleteThread(user: CommentAuthor, threadId: number) {
		const thread = this.requireThread(threadId);
		if (thread.author !== user.sub) throw new CommentError(403, 'Only the person who started a thread can delete it.');
		this.db.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
		this.changed();
	}

	resolve(user: CommentAuthor, threadId: number, resolved: boolean): CommentThread {
		this.transaction(() => {
			this.requireThread(threadId);
			this.saveUser(user, Date.now());
			this.db.prepare('UPDATE threads SET resolved_at = ?, resolved_by = ? WHERE id = ?')
				.run(resolved ? Date.now() : null, resolved ? user.sub : null, threadId);
		});
		this.changed();
		return this.thread(threadId, user.sub);
	}

	/** Read state is per viewer, so it does not notify other viewers. */
	markRead(user: CommentAuthor, threadId: number, read: boolean): CommentThread {
		this.transaction(() => {
			this.requireThread(threadId);
			this.saveUser(user, Date.now());
			if (read) {
				const { id } = this.db.prepare('SELECT max(id) AS id FROM comments WHERE thread = ?').get(threadId) as { id: number };
				this.markReadUpTo(threadId, user.sub, id);
			} else this.db.prepare('DELETE FROM reads WHERE thread = ? AND user = ?').run(threadId, user.sub);
		});
		return this.thread(threadId, user.sub);
	}

	private requireThread(id: number) {
		this.ensureSameFile();
		const row = this.db.prepare('SELECT id, author FROM threads WHERE id = ?').get(id) as { id: number; author: string } | undefined;
		if (!row) throw new CommentError(404, 'This comment no longer exists.');
		return row;
	}

	private requireOwnComment(user: CommentAuthor, id: number) {
		this.ensureSameFile();
		const row = this.db.prepare('SELECT thread, author FROM comments WHERE id = ?').get(id) as { thread: number; author: string } | undefined;
		if (!row) throw new CommentError(404, 'This comment no longer exists.');
		if (row.author !== user.sub) throw new CommentError(403, 'You can only change your own comments.');
		return row;
	}
}
