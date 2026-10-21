// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import MenuFixture from './fixtures/MenuFixture.svelte';

// happy-dom has no Popover API. This stand-in follows the spec where Menu relies on it:
// beforetoggle fires synchronously, toggle is queued, and a popovertarget button toggles its popover.
const open = new WeakSet<HTMLElement>();
function setPopover(element: HTMLElement, show: boolean) {
	if (open.has(element) === show) return;
	const states = show ? { oldState: 'closed', newState: 'open' } : { oldState: 'open', newState: 'closed' };
	// No ToggleEvent either: an Event carrying the same fields.
	const event = (type: string) => Object.assign(new Event(type), states);
	element.dispatchEvent(event('beforetoggle'));
	if (show) open.add(element);
	else open.delete(element);
	setTimeout(() => element.dispatchEvent(event('toggle')));
}
Object.assign(HTMLElement.prototype, {
	showPopover(this: HTMLElement) {
		setPopover(this, true);
	},
	hidePopover(this: HTMLElement) {
		setPopover(this, false);
	}
});
document.addEventListener('click', (event) => {
	const invoker = (event.target as Element).closest('[popovertarget]');
	const target = invoker && document.getElementById(invoker.getAttribute('popovertarget')!);
	if (target) setPopover(target, !open.has(target));
});
const tick = () => new Promise((resolve) => setTimeout(resolve));

let app: ReturnType<typeof mount>;
let trigger: HTMLButtonElement;
let menu: HTMLElement;

const items = () => [...menu.querySelectorAll<HTMLElement>('[role^=menuitem]')];
const focused = () => document.activeElement?.textContent?.trim();
const isOpen = () => open.has(menu.parentElement!);

function press(key: string, target = document.activeElement as HTMLElement) {
	target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	flushSync();
}

async function openMenu() {
	trigger.click();
	await tick();
	flushSync();
}

beforeEach(() => {
	app = mount(MenuFixture, { target: document.body });
	trigger = document.querySelector('button[aria-haspopup=menu]')!;
	menu = document.querySelector('[role=menu]')!;
	trigger.focus();
});

afterEach(() => {
	unmount(app);
	document.body.innerHTML = '';
});

describe('menu semantics', () => {
	it('labels the menu by its trigger and controls it', () => {
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
		expect(menu.getAttribute('aria-labelledby')).toBe(trigger.id);
	});

	it('marks checkable items as menuitemradio with aria-checked', () => {
		expect(items().map((item) => item.getAttribute('role'))).toEqual([
			'menuitemradio',
			'menuitemradio',
			'menuitemradio'
		]);
		expect(items().map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
	});

	it('keeps the footer outside the menu role', () => {
		expect(menu.textContent).not.toContain('Help');
		expect(menu.parentElement!.textContent).toContain('Help');
	});
});

describe('menu keyboard', () => {
	it('moves focus to the checked item when it opens', async () => {
		await openMenu();
		expect(isOpen()).toBe(true);
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		expect(focused()).toBe('b');
	});

	it('opens on ArrowDown at the first item and on ArrowUp at the last', async () => {
		press('ArrowDown', trigger);
		await tick();
		expect(focused()).toBe('a');
		press('Escape');
		await tick();
		press('ArrowUp', trigger);
		await tick();
		expect(focused()).toBe('c');
	});

	it('moves with Up, Down, Home and End, wrapping at the ends', async () => {
		await openMenu();
		press('ArrowDown');
		expect(focused()).toBe('c');
		press('ArrowDown');
		expect(focused()).toBe('a');
		press('ArrowUp');
		expect(focused()).toBe('c');
		press('Home');
		expect(focused()).toBe('a');
		press('End');
		expect(focused()).toBe('c');
	});

	it('closes on Escape, returns focus to the trigger and keeps the key from the page', async () => {
		let reachedWindow = false;
		const onkeydown = () => (reachedWindow = true);
		window.addEventListener('keydown', onkeydown);
		await openMenu();
		press('Escape');
		window.removeEventListener('keydown', onkeydown);
		expect(isOpen()).toBe(false);
		expect(document.activeElement).toBe(trigger);
		expect(reachedWindow).toBe(false);
	});

	it('returns focus to the trigger after choosing an item', async () => {
		await openMenu();
		press('ArrowDown');
		(document.activeElement as HTMLElement).click();
		flushSync();
		expect(isOpen()).toBe(false);
		expect(document.activeElement).toBe(trigger);
		expect(items().map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
	});
});
