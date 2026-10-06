import type { Prototype } from '../types.js';

const HASH = /^#comment-(\d+)$/;

/** An absolute link that opens a thread on the canvas. */
export function threadLink(prototype: Prototype, id: number): string | undefined {
	if (typeof location === 'undefined') return undefined;
	return new URL(`${prototype.paths.canvas()}#comment-${id}`, location.href).href;
}

/** The thread a link like `threadLink` points at, if any. */
export function linkedThread(hash: string): number | undefined {
	const match = HASH.exec(hash);
	return match ? Number(match[1]) : undefined;
}
