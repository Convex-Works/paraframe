// The protocol between a frame (inside an iframe) and the player around it.

export type FrameMessage =
	/** The frame has rendered and its fonts are loaded. */
	| { type: 'paraframe:ready'; frame: string }
	/** A link in the frame was followed. */
	| { type: 'paraframe:navigate'; to: string }
	/** A navigation key was pressed while the frame had focus. */
	| { type: 'paraframe:key'; key: string };

const TYPES = new Set(['paraframe:ready', 'paraframe:navigate', 'paraframe:key']);

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

/**
 * Keys the player handles. Frames forward them so shortcuts work while a
 * frame has focus. Comments listen in the frame themselves for C and Escape.
 */
export const PLAYER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'r', 'R']);

/**
 * The element a key was pressed in. A window listener sees a key typed inside a
 * shadow root, such as visual-comments' composer, as coming from the root's
 * host, so ask the event's path for the element itself.
 */
export function keyTarget(event: Event): EventTarget | null {
	return event.composedPath()[0] ?? event.target;
}

export function isEditable(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
	);
}

// Controls that act on Enter themselves.
const ACTIVATES_ON_ENTER =
	'a[href],button,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=switch],' +
	'[role=radio],[role=option],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]';

/** Whether Enter on this target belongs to a focused control rather than to a global shortcut. */
export function activatesOnEnter(target: EventTarget | null) {
	return target instanceof Element && target.closest(ACTIVATES_ON_ENTER) !== null;
}
