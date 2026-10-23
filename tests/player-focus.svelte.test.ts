// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Player from '../src/lib/Player.svelte';
import { definePrototype } from '../src/lib/prototype.js';
import type { FrameComponent } from '../src/lib/types.js';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const load = async () => ({ default: (() => {}) as unknown as FrameComponent });
const prototype = definePrototype({
	title: 'Demo',
	paths: { canvas: () => '/', play: (id) => `/play/${id}`, frame: (id) => `/frame/${id}` },
	sections: [
		{
			id: 'app',
			title: 'App',
			frames: [
				{ id: 'home', title: 'Home', load },
				{ id: 'settings', title: 'Settings', load }
			]
		}
	]
});

let app: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (app) unmount(app);
	app = undefined;
	document.body.innerHTML = '';
});

const iframe = (id: string) => document.querySelector<HTMLIFrameElement>(`iframe[src="/frame/${id}"]`)!;

// What FrameHost posts once the frame in that iframe has rendered. happy-dom doesn't load
// the iframes, so each gets a stand-in window for the player to match the message to.
function ready(id: string) {
	for (const el of document.querySelectorAll('iframe')) {
		if (!Object.hasOwn(el, 'contentWindow')) Object.defineProperty(el, 'contentWindow', { value: {} });
	}
	const source = iframe(id).contentWindow;
	window.dispatchEvent(
		new MessageEvent('message', { data: { type: 'paraframe:ready', frame: id }, origin: location.origin, source })
	);
	flushSync();
}

function play(frameId: string) {
	const props = $state({ prototype, frameId });
	app = mount(Player, { target: document.body, props });
	flushSync();
	return props;
}

describe('Player', () => {
	it('titles the page after the frame and the prototype', () => {
		const props = play('home');
		expect(document.title).toBe('Home – Demo');
		props.frameId = 'settings';
		flushSync();
		expect(document.title).toBe('Settings – Demo');
	});

	it('hands focus to the new frame when the focused one goes away', () => {
		const props = play('home');
		iframe('home').focus();
		expect(document.activeElement).toBe(iframe('home'));

		props.frameId = 'settings';
		flushSync();
		ready('settings');

		expect(document.querySelector('iframe[src="/frame/home"]')).toBeNull();
		expect(document.activeElement).toBe(iframe('settings'));
	});

	it('leaves focus alone when the outgoing frame did not have it', () => {
		const props = play('home');
		const toolbar = document.querySelector<HTMLAnchorElement>('a[aria-label="All frames (canvas)"]')!;
		toolbar.focus();

		props.frameId = 'settings';
		flushSync();
		ready('settings');

		expect(document.activeElement).toBe(toolbar);
	});
});
