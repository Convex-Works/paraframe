<!--
  A button that opens a popover menu below it. Items close the menu with `close()`.
  Follows the ARIA menu button pattern: opening moves focus to the checked item
  (or the first), Up/Down/Home/End move between items, and Escape, Tab or
  choosing an item closes the menu and returns focus to the trigger.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		trigger,
		children,
		footer,
		align = 'start',
		tone = 'light',
		class: className = ''
	}: {
		/** Accessible name for the trigger and the menu. */
		label: string;
		trigger: Snippet;
		children: Snippet<[close: () => void]>;
		/** Non-interactive content shown below the items, outside the menu role. */
		footer?: Snippet;
		align?: 'start' | 'end';
		tone?: 'light' | 'dark';
		class?: string;
	} = $props();

	const id = $props.id();
	let button = $state<HTMLButtonElement>();
	let popover = $state<HTMLDivElement>();
	let menu = $state<HTMLDivElement>();
	let open = $state(false);
	// Which item gets focus when the menu opens: the checked one (or first) unless a key asked otherwise.
	let initial: 'first' | 'last' | undefined;

	const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])];

	function beforetoggle(event: ToggleEvent) {
		// Closing with focus inside the menu (Escape, Tab, an item was chosen): hand focus back to the trigger.
		if (event.newState === 'closed' && popover?.contains(document.activeElement)) button?.focus();
	}

	function ontoggle(event: ToggleEvent) {
		open = event.newState === 'open';
		if (!open || !button || !popover) return;
		const rect = button.getBoundingClientRect();
		const gutter = 12;
		const left = align === 'start' ? rect.left : rect.right - popover.offsetWidth;
		popover.style.left = `${Math.max(gutter, Math.min(left, window.innerWidth - popover.offsetWidth - gutter))}px`;
		popover.style.top = `${Math.max(gutter, Math.min(rect.bottom + 6, window.innerHeight - popover.offsetHeight - gutter))}px`;

		focusItem(initial);
		initial = undefined;
	}

	function focusItem(which?: 'first' | 'last') {
		const all = items();
		const checked = which ? undefined : all.find((item) => item.getAttribute('aria-checked') === 'true');
		(checked ?? (which === 'last' ? all.at(-1) : all[0]))?.focus();
	}

	function ontriggerkeydown(event: KeyboardEvent) {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		const which = event.key === 'ArrowUp' ? 'last' : 'first';
		if (open) return focusItem(which);
		initial = which;
		popover?.showPopover();
	}

	function onmenukeydown(event: KeyboardEvent) {
		const all = items();
		const index = all.indexOf(document.activeElement as HTMLElement);
		let next: HTMLElement | undefined;
		if (event.key === 'ArrowDown') next = all[(index + 1) % all.length];
		else if (event.key === 'ArrowUp') next = all.at(index - 1);
		else if (event.key === 'Home') next = all[0];
		else if (event.key === 'End') next = all.at(-1);
		else if (event.key === 'Escape') {
			// Only the menu closes; the canvas and comments don't see this Escape.
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		} else if (event.key === 'Tab') {
			// Close and let Tab move on from the trigger.
			close();
			return;
		} else return;
		event.preventDefault();
		next?.focus();
	}

	const close = () => popover?.hidePopover();
</script>

<button
	bind:this={button}
	type="button"
	id="pf-menu-button-{id}"
	popovertarget="pf-menu-{id}"
	aria-label={label}
	aria-haspopup="menu"
	aria-expanded={open}
	aria-controls="pf-menu-items-{id}"
	title={label}
	class={className}
	onkeydown={ontriggerkeydown}
>
	{@render trigger()}
</button>
<div
	bind:this={popover}
	id="pf-menu-{id}"
	popover="auto"
	onbeforetoggle={beforetoggle}
	{ontoggle}
	class={[
		'pf-menu fixed inset-auto m-0 max-h-[min(70vh,560px)] w-max min-w-52 max-w-[calc(100vw-24px)] overflow-y-auto rounded border p-1 text-[13px] shadow-lg',
		tone === 'dark'
			? 'border-white/10 bg-pf-ink text-white/90'
			: 'border-pf-line bg-pf-surface text-pf-ink'
	]}
>
	<div
		bind:this={menu}
		id="pf-menu-items-{id}"
		role="menu"
		tabindex="-1"
		aria-labelledby="pf-menu-button-{id}"
		onkeydown={onmenukeydown}
	>
		{@render children(close)}
	</div>
	{@render footer?.()}
</div>
