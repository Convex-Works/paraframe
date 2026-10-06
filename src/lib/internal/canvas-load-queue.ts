export type ScheduleFrameLoad = (start: (complete: () => void) => void) => () => void;

// Loading and hydration share the canvas's main thread. Leave a short gap after
// each ready frame, and don't let a failed readiness message stall the queue.
const START_GAP_MS = 50;
const LOAD_TIMEOUT_MS = 5_000;

export function createCanvasLoadQueue() {
	type Entry = { start: () => void };
	const pending = new Set<Entry>();
	let paused = true;
	let destroyed = false;
	let active: Entry | undefined;
	let startTimer: ReturnType<typeof setTimeout> | undefined;
	let loadTimer: ReturnType<typeof setTimeout> | undefined;

	function schedule(delay = 0) {
		if (paused || destroyed || active || startTimer !== undefined || !pending.size) return;
		startTimer = setTimeout(() => {
			startTimer = undefined;
			const entry = pending.values().next().value;
			if (paused || destroyed || active || !entry) return;
			pending.delete(entry);
			active = entry;
			entry.start();
		}, delay);
	}

	const request: ScheduleFrameLoad = (start) => {
		if (destroyed) return () => {};
		const complete = () => {
			if (active !== entry) return;
			clearTimeout(loadTimer);
			loadTimer = undefined;
			active = undefined;
			schedule(START_GAP_MS);
		};
		const entry: Entry = {
			start: () => {
				loadTimer = setTimeout(complete, LOAD_TIMEOUT_MS);
				start(complete);
			}
		};
		pending.add(entry);
		schedule();
		return () => {
			pending.delete(entry);
			complete();
		};
	};

	function pause() {
		paused = true;
		clearTimeout(startTimer);
		startTimer = undefined;
	}

	return {
		request,
		pause,
		resume() {
			paused = false;
			schedule();
		},
		destroy() {
			destroyed = true;
			pause();
			clearTimeout(loadTimer);
			pending.clear();
			active = undefined;
		}
	};
}
