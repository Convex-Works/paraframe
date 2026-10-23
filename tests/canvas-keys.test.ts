// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { activatesOnEnter, isEditable, keyTarget } from '../src/lib/messages.js';

function element(html: string) {
	document.body.innerHTML = html;
	return document.body.querySelector('[data-target]') ?? document.body.firstElementChild!;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('Enter on the canvas', () => {
	it.each([
		['a button', '<button type="button">Zoom</button>'],
		['a link', '<a href="/play/home">Home</a>'],
		['a menu item', '<div role="menu"><div role="menuitem" tabindex="-1" data-target>Fit</div></div>'],
		['a checkable menu item', '<div role="menuitemradio" aria-checked="true" tabindex="-1">100%</div>'],
		['a disclosure', '<details><summary data-target>More</summary></details>'],
		['something inside a button', '<button><svg data-target></svg> Play</button>']
	])('is left to %s', (_, html) => {
		expect(activatesOnEnter(element(html))).toBe(true);
	});

	it.each([
		['the body', () => document.body],
		['the canvas', () => element('<div role="region" aria-label="Canvas of all frames">Canvas</div>')],
		['a plain element', () => element('<p>Text</p>')],
		['an anchor without href', () => element('<a>Placeholder</a>')],
		['the window', () => window],
		['no target', () => null]
	])('plays the selection from %s', (_, target) => {
		expect(activatesOnEnter(target())).toBe(false);
	});
});

describe('A key typed in a shadow root', () => {
	// What the canvas and player see at the window while someone writes a comment.
	function keyAtWindow(inside: string) {
		const host = element('<div data-target></div>');
		const root = host.attachShadow({ mode: 'open' });
		root.innerHTML = inside;
		let seen: KeyboardEvent | undefined;
		const listen = (event: KeyboardEvent) => (seen = event);
		window.addEventListener('keydown', listen);
		root.querySelector('[data-key]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, composed: true }));
		window.removeEventListener('keydown', listen);
		return seen!;
	}

	// Browsers report the host as the target at the window; the path still starts at the textarea.
	it('comes from the element it was typed in', () => {
		expect(isEditable(keyTarget(keyAtWindow('<textarea data-key></textarea>')))).toBe(true);
	});

	it('leaves Enter to a button in the shadow root', () => {
		expect(activatesOnEnter(keyTarget(keyAtWindow('<button data-key>Send</button>')))).toBe(true);
	});
});
