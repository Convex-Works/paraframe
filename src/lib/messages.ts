// The protocol between a frame (inside an iframe) and the player around it.

export type FrameMessage =
	/** The frame has rendered and its fonts are loaded. */
	| { type: 'paraframe:ready'; frame: string }
	/** A link in the frame was followed. */
	| { type: 'paraframe:navigate'; to: string }
	/** A navigation key was pressed while the frame had focus. */
	| { type: 'paraframe:key'; key: string }
	/** The frame scrolled, resized or changed, so pins on its elements move. */
	| { type: 'paraframe:layout'; frame: string };

const TYPES = new Set(['paraframe:ready', 'paraframe:navigate', 'paraframe:key', 'paraframe:layout']);

export function isFrameMessage(data: unknown): data is FrameMessage {
	return (
		typeof data === 'object' &&
		data !== null &&
		TYPES.has((data as { type?: unknown }).type as string)
	);
}

export function postToHost(message: FrameMessage) {
	if (window.parent !== window) window.parent.postMessage(message, location.origin);
}

/** Keys the player handles. Frames forward them so shortcuts work while a frame has focus. */
export const PLAYER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'r', 'R', 'c', 'C']);

export function isEditable(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
	);
}
