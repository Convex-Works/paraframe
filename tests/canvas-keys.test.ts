// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { activatesOnEnter } from '../src/lib/messages.js';

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
		['the canvas', () => element('<div role="application" tabindex="0">Canvas</div>')],
		['a plain element', () => element('<p>Text</p>')],
		['an anchor without href', () => element('<a>Placeholder</a>')],
		['the window', () => window],
		['no target', () => null]
	])('plays the selection from %s', (_, target) => {
		expect(activatesOnEnter(target())).toBe(false);
	});
});
