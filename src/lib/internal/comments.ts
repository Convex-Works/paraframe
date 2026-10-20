import { getContext, setContext } from 'svelte';
import type { Prototype } from '../types.js';

// The parts of visual-comments that the canvas and player use, declared here
// so the main entry never needs visual-comments, even for its types.

/** The part of a comment thread the canvas and player read. */
export interface CommentThreadPin {
	/** The frame it is on. */
	surface: string;
	/** Pin position in the frame's CSS pixels. */
	x: number;
	y: number;
}

export interface CommentsOptions {
	show?: (thread: CommentThreadPin) => boolean | void;
	describe?: (surface: string) => { title?: string; order?: number } | undefined;
}

/** What the canvas and player use of visual-comments' `VisualComments`. */
export interface CommentsController {
	readonly active: boolean;
	readonly openId: number | undefined;
	readonly unreadCount: number;
	toggle(): unknown;
	configure(options: CommentsOptions): void;
}

/** The comments of the prototype, once they have started in the browser. */
export interface ParaframeComments {
	readonly current: CommentsController | undefined;
}

const KEY = Symbol('paraframe.comments');

export function setComments(comments: ParaframeComments) {
	setContext(KEY, comments);
}

/** The comments object itself, for components that read it reactively. */
export function useCommentsHolder(): ParaframeComments | undefined {
	return getContext<ParaframeComments | undefined>(KEY);
}

/** A frame's title and place in reading order, for threads on frames not on screen. */
export function describeFrame(prototype: Prototype, id: string) {
	const frame = prototype.get(id);
	return frame && { title: frame.title, order: frame.index };
}
