import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Comment, CommentAuthor, CommentThread } from '../comments.js';

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
	body: string;
}

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

/** Comment threads in one SQLite file. Synchronous: each call is atomic in a Node process. */
export class CommentStore {
	/** Dispatches `change` after every write. */
	readonly events = new EventTarget();
	private db: DatabaseSync;

	constructor(filename: string) {
		if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
		this.db = new DatabaseSync(filename);
		this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
		const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
		if (version === 0) this.transaction(() => {
			for (const statement of SCHEMA) this.db.exec(statement);
			this.db.exec('PRAGMA user_version = 1');
		});
	}

	close() {
		this.db.close();
	}

	private transaction<T>(run: () => T): T {
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

	private addComment(thread: number, user: string, body: string, now: number) {
		const { lastInsertRowid } = this.db.prepare(
			'INSERT INTO comments (thread, author, body, created_at) VALUES (?, ?, ?, ?)'
		).run(thread, user, body, now);
		this.markReadUpTo(thread, user, Number(lastInsertRowid));
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
		for (const row of commentRows) {
			const thread = threads.get(row.thread as number);
			if (!thread) continue;
			const comment: Comment = {
				id: row.id as number,
				author: author(row.author as string),
				body: row.body as string,
				createdAt: row.created_at as number,
				editedAt: row.edited_at as number | null
			};
			thread.comments.push(comment);
			if (viewer && comment.author.sub !== viewer && comment.id > thread.readUpTo) thread.unread = true;
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
				'INSERT INTO threads (frame, x, y, author, created_at) VALUES (?, ?, ?, ?, ?)'
			).run(input.frame, input.x, input.y, user.sub, now);
			const id = Number(lastInsertRowid);
			this.addComment(id, user.sub, input.body, now);
			return id;
		});
		this.changed();
		return this.thread(id, user.sub);
	}

	reply(user: CommentAuthor, threadId: number, body: string): CommentThread {
		const now = Date.now();
		this.transaction(() => {
			this.requireThread(threadId);
			this.saveUser(user, now);
			this.addComment(threadId, user.sub, body, now);
			// Replying to a resolved thread reopens it.
			this.db.prepare('UPDATE threads SET resolved_at = NULL, resolved_by = NULL WHERE id = ?').run(threadId);
		});
		this.changed();
		return this.thread(threadId, user.sub);
	}

	editComment(user: CommentAuthor, commentId: number, body: string): CommentThread {
		const comment = this.requireOwnComment(user, commentId);
		this.transaction(() => {
			this.saveUser(user, Date.now());
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
		const row = this.db.prepare('SELECT id, author FROM threads WHERE id = ?').get(id) as { id: number; author: string } | undefined;
		if (!row) throw new CommentError(404, 'This comment no longer exists.');
		return row;
	}

	private requireOwnComment(user: CommentAuthor, id: number) {
		const row = this.db.prepare('SELECT thread, author FROM comments WHERE id = ?').get(id) as { thread: number; author: string } | undefined;
		if (!row) throw new CommentError(404, 'This comment no longer exists.');
		if (row.author !== user.sub) throw new CommentError(403, 'You can only change your own comments.');
		return row;
	}
}
