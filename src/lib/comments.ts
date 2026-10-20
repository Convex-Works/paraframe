// `paraframe/comments`: the parts of paraframe that need visual-comments, an
// optional peer dependency. The main entry never imports it.
import type { VisualComments } from 'visual-comments';
import { useCommentsHolder } from './internal/comments.js';

export { default as Comments } from './Comments.svelte';

/** Undefined while signed-out viewers cannot see comments: before mount, or without a `Comments` provider. */
export function useComments(): VisualComments | undefined {
	// Only `Comments` provides the holder, and it holds a `VisualComments`.
	return useCommentsHolder()?.current as VisualComments | undefined;
}
