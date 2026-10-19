import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvasLoadQueue } from '../src/lib/internal/canvas-load-queue.js';

const GAP = 50;
const TIMEOUT = 5_000;

// A frame as CanvasPreview sees it: it asks the queue for a slot, records when
// the queue starts it, and can report ready or cancel.
function frame(queue: ReturnType<typeof createCanvasLoadQueue>) {
	const state = { started: 0, ready: () => {}, cancel: () => {} };
	state.cancel = queue.request((complete) => {
		state.started++;
		state.ready = complete;
	});
	return state;
}

let queue: ReturnType<typeof createCanvasLoadQueue>;

beforeEach(() => {
	vi.useFakeTimers();
	queue = createCanvasLoadQueue();
});

afterEach(() => {
	queue.destroy();
	vi.useRealTimers();
});

describe('idle gating', () => {
	it('starts nothing until the canvas reports it is idle', () => {
		const a = frame(queue);
		vi.advanceTimersByTime(10_000);
		expect(a.started).toBe(0);

		queue.resume();
		vi.advanceTimersByTime(0);
		expect(a.started).toBe(1);
	});

	it('drops a pending start when a gesture begins before it fires', () => {
		const a = frame(queue);
		queue.resume();
		queue.pause();
		vi.advanceTimersByTime(1_000);
		expect(a.started).toBe(0);

		queue.resume();
		vi.advanceTimersByTime(0);
		expect(a.started).toBe(1);
	});
});

describe('one-at-a-time startup', () => {
	it('starts the next frame only after the previous one is ready, plus a gap', () => {
		const a = frame(queue);
		const b = frame(queue);
		const c = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(0);
		expect([a.started, b.started, c.started]).toEqual([1, 0, 0]);

		vi.advanceTimersByTime(1_000);
		expect(b.started).toBe(0);

		a.ready();
		vi.advanceTimersByTime(GAP - 1);
		expect(b.started).toBe(0);
		vi.advanceTimersByTime(1);
		expect([a.started, b.started, c.started]).toEqual([1, 1, 0]);

		b.ready();
		vi.advanceTimersByTime(GAP);
		expect([a.started, b.started, c.started]).toEqual([1, 1, 1]);
	});

	it('starts frames in request order and each only once', () => {
		const frames = [frame(queue), frame(queue), frame(queue)];
		const order: number[] = [];
		queue.resume();
		for (let i = 0; i < frames.length; i++) {
			vi.advanceTimersByTime(GAP);
			const started = frames.findIndex((f, j) => f.started && !order.includes(j));
			order.push(started);
			frames[started].ready();
			frames[started].ready();
		}
		vi.advanceTimersByTime(GAP);
		expect(order).toEqual([0, 1, 2]);
		expect(frames.map((f) => f.started)).toEqual([1, 1, 1]);
	});

	it('starts a frame requested while the queue is idle and empty', () => {
		queue.resume();
		const a = frame(queue);
		vi.advanceTimersByTime(0);
		expect(a.started).toBe(1);
	});
});

describe('pause during a drag', () => {
	it('lets the active frame finish but holds the next until the drag ends', () => {
		const a = frame(queue);
		const b = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(0);

		queue.pause();
		a.ready();
		vi.advanceTimersByTime(2_000);
		expect(b.started).toBe(0);

		queue.resume();
		vi.advanceTimersByTime(0);
		expect(b.started).toBe(1);
	});

	it('cancels the gap timer if a drag starts during the gap', () => {
		const a = frame(queue);
		const b = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(0);
		a.ready();
		vi.advanceTimersByTime(GAP / 2);

		queue.pause();
		vi.advanceTimersByTime(2_000);
		expect(b.started).toBe(0);

		queue.resume();
		vi.advanceTimersByTime(0);
		expect(b.started).toBe(1);
	});
});

describe('queued cancellation', () => {
	it('never starts a frame that left the queue before its turn', () => {
		const a = frame(queue);
		const b = frame(queue);
		const c = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(0);

		b.cancel();
		a.ready();
		vi.advanceTimersByTime(GAP);
		expect([b.started, c.started]).toEqual([0, 1]);
	});

	it('frees the slot when the active frame is cancelled', () => {
		const a = frame(queue);
		const b = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(0);

		a.cancel();
		vi.advanceTimersByTime(GAP);
		expect(b.started).toBe(1);
	});

	it('ignores a stale cancel or ready from a frame that no longer holds the slot', () => {
		const a = frame(queue);
		const b = frame(queue);
		const c = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(0);
		a.ready();
		vi.advanceTimersByTime(GAP);
		expect(b.started).toBe(1);

		a.cancel();
		a.ready();
		vi.advanceTimersByTime(1_000);
		expect(c.started).toBe(0);
	});

	it('runs nothing when every queued frame is cancelled', () => {
		const a = frame(queue);
		const b = frame(queue);
		a.cancel();
		b.cancel();
		queue.resume();
		vi.advanceTimersByTime(TIMEOUT * 2);
		expect([a.started, b.started]).toEqual([0, 0]);
	});
});

describe('failed frame', () => {
	it('releases the slot after five seconds if a frame never reports ready', () => {
		const a = frame(queue);
		const b = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(0);

		vi.advanceTimersByTime(TIMEOUT - 1);
		expect(b.started).toBe(0);
		vi.advanceTimersByTime(1 + GAP);
		expect(b.started).toBe(1);
	});

	it('does not let a late ready from a timed-out frame release the next one early', () => {
		const a = frame(queue);
		const b = frame(queue);
		const c = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(TIMEOUT + GAP);
		expect(b.started).toBe(1);

		a.ready();
		vi.advanceTimersByTime(GAP);
		expect(c.started).toBe(0);

		b.ready();
		vi.advanceTimersByTime(GAP);
		expect(c.started).toBe(1);
	});

	it('restarts the timeout for each frame', () => {
		const a = frame(queue);
		const b = frame(queue);
		const c = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(TIMEOUT - 1);
		a.ready();
		vi.advanceTimersByTime(GAP);
		expect(b.started).toBe(1);

		vi.advanceTimersByTime(TIMEOUT - 1);
		expect(c.started).toBe(0);
		vi.advanceTimersByTime(1 + GAP);
		expect(c.started).toBe(1);
	});
});

describe('destroy', () => {
	it('stops pending starts and ignores later requests', () => {
		const a = frame(queue);
		const b = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(0);
		queue.destroy();

		a.ready();
		const c = frame(queue);
		queue.resume();
		vi.advanceTimersByTime(TIMEOUT * 2);
		expect([b.started, c.started]).toEqual([0, 0]);
	});
});
