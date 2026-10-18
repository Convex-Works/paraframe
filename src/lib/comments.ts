import { getContext, setContext } from 'svelte';
import type { VisualComments } from 'visual-comments';
import type { Prototype } from './types.js';

/** The comments of the prototype, once they have started in the browser. */
export interface ParaframeComments {
	readonly current: VisualComments | undefined;
}

const KEY = Symbol('paraframe.comments');

export function setComments(comments: ParaframeComments) {
	setContext(KEY, comments);
}

/** Undefined while signed-out viewers cannot see comments: before mount, or without a `Comments` provider. */
export function useComments(): VisualComments | undefined {
	return getContext<ParaframeComments | undefined>(KEY)?.current;
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
