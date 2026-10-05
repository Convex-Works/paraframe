<!-- A button that opens a popover menu below it. Items close the menu with `close()`. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		trigger,
		children,
		align = 'start',
		tone = 'light',
		class: className = ''
	}: {
		/** Accessible name for the trigger. */
		label: string;
		trigger: Snippet;
		children: Snippet<[close: () => void]>;
		align?: 'start' | 'end';
		tone?: 'light' | 'dark';
		class?: string;
	} = $props();

	const id = $props.id();
	let button = $state<HTMLButtonElement>();
	let popover = $state<HTMLDivElement>();

	function place(event: ToggleEvent) {
		if (event.newState !== 'open' || !button || !popover) return;
		const rect = button.getBoundingClientRect();
		popover.style.top = `${rect.bottom + 6}px`;
		if (align === 'start') {
			popover.style.left = `${rect.left}px`;
			popover.style.right = 'auto';
		} else {
			popover.style.right = `${window.innerWidth - rect.right}px`;
			popover.style.left = 'auto';
		}
	}

	const close = () => popover?.hidePopover();
</script>

<button
	bind:this={button}
	type="button"
	popovertarget="pf-menu-{id}"
	aria-label={label}
	title={label}
	class={className}
>
	{@render trigger()}
</button>
<div
	bind:this={popover}
	id="pf-menu-{id}"
	popover="auto"
	onbeforetoggle={place}
	class={[
		'pf-menu fixed inset-auto m-0 max-h-[min(70vh,560px)] min-w-52 overflow-y-auto rounded-lg border p-1 text-[13px] shadow-xl',
		tone === 'dark'
			? 'border-white/10 bg-pf-ink text-white/90'
			: 'border-pf-line bg-white text-pf-ink'
	]}
>
	{@render children(close)}
</div>
