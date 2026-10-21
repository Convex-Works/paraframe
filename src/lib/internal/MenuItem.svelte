<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		onselect,
		checked,
		children,
		hint,
		tone = 'light'
	}: {
		onselect: () => void;
		/** Makes this a radio item (`menuitemradio` with `aria-checked`) with a check mark column when not undefined. */
		checked?: boolean;
		children: Snippet;
		hint?: string;
		tone?: 'light' | 'dark';
	} = $props();
</script>

<button
	type="button"
	role={checked === undefined ? 'menuitem' : 'menuitemradio'}
	aria-checked={checked}
	tabindex="-1"
	onclick={onselect}
	class={[
		'flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-left',
		tone === 'dark' ? 'hover:bg-white/10 focus-visible:bg-white/10' : 'hover:bg-pf-wash focus-visible:bg-pf-wash',
		'outline-none'
	]}
>
	{#if checked !== undefined}
		<span class="w-4 shrink-0 text-pf-accent" aria-hidden="true">
			{#if checked}<Icon name="check" size={14} />{/if}
		</span>
	{/if}
	<span class="min-w-0 flex-1 truncate">{@render children()}</span>
	{#if hint}<span class="shrink-0 opacity-50">{hint}</span>{/if}
</button>
