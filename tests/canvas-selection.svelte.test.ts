// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Canvas from '../src/lib/Canvas.svelte';
import { definePrototype } from '../src/lib/prototype.js';
import type { FrameComponent } from '../src/lib/types.js';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const load = async () => ({ default: (() => {}) as unknown as FrameComponent });
const prototype = definePrototype({
	title: 'Selection',
	paths: { canvas: () => '/', play: (id) => `/play/${id}`, frame: (id) => `/frame/${id}` },
	sections: [
		{ id: 'onboarding', title: 'Onboarding', frames: [{ id: 'welcome', title: 'Welcome', load }] },
		{ id: 'app', title: 'App', frames: [{ id: 'home', title: 'Home', load }] }
	]
});

// happy-dom lays nothing out; give the viewport a size so the canvas zooms to show frame labels.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 });

let app: ReturnType<typeof mount>;

beforeEach(() => {
	sessionStorage.clear();
	app = mount(Canvas, { target: document.body, props: { prototype } });
	flushSync();
});

afterEach(() => {
	unmount(app);
	document.body.innerHTML = '';
});

const status = () => document.querySelector('[role=status]')!;
const playButton = () =>
	[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Play')!;
const label = (title: string) =>
	[...document.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent?.trim() === title);

function press(code: string) {
	window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
	flushSync();
}

describe('Canvas selection for screen readers', () => {
	it('announces the frame that → selects', () => {
		expect(status().textContent).toBe('');
		press('ArrowRight');
		expect(status().textContent).toBe('Welcome, Onboarding. Enter to play.');
		press('ArrowRight');
		expect(status().textContent).toBe('Home, App. Enter to play.');
	});

	it('names the frame Play will start from', () => {
		expect(playButton().getAttribute('aria-label')).toBeNull();
		press('ArrowRight');
		expect(playButton().getAttribute('aria-label')).toBe('Play from Welcome');
	});

	it('marks the selected frame label as pressed', () => {
		press('ArrowRight');
		expect(label('Welcome')?.getAttribute('aria-pressed')).toBe('true');
		expect(label('Home')?.getAttribute('aria-pressed')).toBe('false');
	});

	it('clears the announcement when Escape drops the selection', () => {
		press('ArrowRight');
		press('Escape');
		expect(status().textContent).toBe('');
	});

	it('is a labelled region, not an application', () => {
		expect(document.querySelector('[role=application]')).toBeNull();
		expect(document.querySelector('[role=region]')?.getAttribute('aria-label')).toBe('Canvas of all frames');
	});
});
