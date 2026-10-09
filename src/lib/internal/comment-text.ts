import type { Comment } from '../comments.js';

/** A comment's text for previews, or what it holds when it is only images. */
export function commentText(comment: Comment): string {
	if (comment.body) return comment.body;
	const count = comment.images?.length ?? 0;
	return count === 1 ? 'Image' : `${count} images`;
}
