import { getContext, setContext } from 'svelte';
import type { CommentsClient } from './internal/comments-client.svelte.js';

/** Who wrote a comment. Supplied by the host's server, usually from its sign-in session. */
export interface CommentAuthor {
	sub: string;
	name: string;
	picture?: string;
}

/** An image in a comment, served at `<comments path>/images/<id>`. */
export interface CommentImage {
	id: number;
	/** Its size in pixels, so it can be laid out before it loads. */
	width: number;
	height: number;
}

export interface Comment {
	id: number;
	author: CommentAuthor;
	/** Empty when the comment is only images. */
	body: string;
	images: CommentImage[];
	/** Milliseconds since the epoch. */
	createdAt: number;
	editedAt: number | null;
	/** Sent but not yet confirmed by the server. */
	pending?: boolean;
}

/** The element a pin was placed on, as it was then. */
export interface CommentAnchor {
	/** A CSS selector for it in the frame's document. */
	selector: string;
	/** What it is and what it says, e.g. `button “Add prompts”`. */
	label: string;
	/** Its visible text, shortened. */
	text: string;
	/** Its box in the frame's CSS pixels. */
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A pin on a frame and the conversation under it. The first comment opens the thread. */
export interface CommentThread {
	/** Also the thread's number, shown as #id. Never reused. */
	id: number;
	frame: string;
	/** Pin position in the frame's CSS pixels, from its top-left corner. */
	x: number;
	y: number;
	/** Null for a pin in open space. */
	anchor: CommentAnchor | null;
	createdAt: number;
	resolvedAt: number | null;
	resolvedBy: CommentAuthor | null;
	/** Someone else has written in the thread since the viewer last opened it. */
	unread: boolean;
	comments: Comment[];
}

export interface CommentsSnapshot {
	/** Null when signed out. */
	viewer: CommentAuthor | null;
	threads: CommentThread[];
}

export interface CommentFilters {
	query: string;
	sort: 'date' | 'frame';
	showResolved: boolean;
	onlyMine: boolean;
}

/** Comment threads and the viewer's comment mode, shared by the canvas and player. */
export type ParaframeComments = CommentsClient;

const KEY = Symbol('paraframe.comments');

export function setComments(comments: ParaframeComments) {
	setContext(KEY, comments);
}

/** Undefined when the host has not added a CommentsProvider. */
export function useComments(): ParaframeComments | undefined {
	return getContext<ParaframeComments | undefined>(KEY);
}
