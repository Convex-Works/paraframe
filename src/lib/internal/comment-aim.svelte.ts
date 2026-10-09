import type { CommentAim } from './comment-target.js';

export interface Pointer {
	clientX: number;
	clientY: number;
	altKey: boolean;
}

/** Follows where the pointer aims in comment mode, at most once per animation frame. */
export class CommentAimer {
	aim = $state<CommentAim>();
	/** The pointer in client pixels while it is over the frames, for the drawn comment cursor. */
	cursor = $state<{ x: number; y: number }>();
	#pointer: Pointer | undefined;
	#request = 0;
	#find: (pointer: Pointer) => CommentAim | undefined;

	/** `find` returns undefined whenever a click would not start a thread. */
	constructor(find: (pointer: Pointer) => CommentAim | undefined) {
		this.#find = find;
	}

	/** The pointer moved, or left (undefined). */
	move(pointer: Pointer | undefined) {
		this.#pointer = pointer && { clientX: pointer.clientX, clientY: pointer.clientY, altKey: pointer.altKey };
		// Set at once, not on the next frame, so the drawn cursor keeps up with the pointer.
		this.cursor = pointer && { x: pointer.clientX, y: pointer.clientY };
		this.update();
	}

	/** Alt pins anywhere: pressing or releasing it re-aims without a move. */
	key(event: KeyboardEvent) {
		if (event.key !== 'Alt' || !this.#pointer) return;
		this.#pointer.altKey = event.type === 'keydown';
		this.update();
	}

	/** Aims again, e.g. when the view moved under a still pointer. */
	update() {
		cancelAnimationFrame(this.#request);
		this.#request = requestAnimationFrame(() => {
			this.aim = this.#pointer && this.#find(this.#pointer);
		});
	}
}
