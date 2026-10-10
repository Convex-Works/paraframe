<!--
  A thread's marker. Its bottom-left point sits on the spot that was clicked.
  On hover it grows from that point into a preview of the first comment. It
  pops out of that point when it appears (loaded, added, scrolled into view)
  and shrinks back into it when it goes.
-->
<script lang="ts" module>
	import { backOut, cubicIn } from 'svelte/easing';

	/** Scales from the pin's point (its bottom-left corner), keeping its lift above it. */
	function pop(_node: Element, { duration, easing }: { duration: number; easing: (t: number) => number }) {
		const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
		return {
			duration: still ? 0 : duration,
			easing,
			css: (t: number) =>
				`transform-origin: 0 100%; transform: translateY(-100%) scale(${0.2 + 0.8 * t}); opacity: ${Math.min(1, t * 2)}`
		};
	}
</script>

<script lang="ts">
	import Avatar from './Avatar.svelte';
	import { commentText } from './comment-text.js';
	import { ago } from './time.js';
	import type { CommentThread } from '../comments.js';

	let { thread, left, top, open, now, onopen }: {
		thread: CommentThread;
		/** The anchor, in the layer's pixels. */
		left: number;
		top: number;
		open: boolean;
		now: number;
		onopen: () => void;
	} = $props();

	const SIZE = 32;
	const root = $derived(thread.comments[0]);
	const text = $derived(commentText(root));
	const replies = $derived(thread.comments.length - 1);

	let hovered = $state(false);
	let focused = $state(false);
	let textWidth = $state(0);
	let textHeight = $state(0);
	const expanded = $derived((hovered || focused) && !open && textWidth > 0);
</script>

<button
	type="button"
	data-pf-ui
	class={[
		'pf-pin pointer-events-auto absolute block overflow-hidden bg-white text-left outline-none',
		expanded ? 'z-30' : open ? 'z-20' : 'z-10',
		thread.resolvedAt && !expanded && !open && 'opacity-60',
		expanded && 'pf-pin-expanded'
	]}
	style:left="{left}px"
	style:top="{top}px"
	style:width="{expanded ? textWidth + 54 : SIZE}px"
	style:height="{expanded ? Math.max(44, textHeight + 20) : SIZE}px"
	style:border-radius={expanded ? '18px 18px 18px 4px' : `${SIZE / 2}px ${SIZE / 2}px ${SIZE / 2}px 0`}
	style:box-shadow={open
		? '0 0 0 2px var(--pf-comment), 0 2px 8px rgb(0 0 0 / 0.25)'
		: expanded
			? '0 4px 18px rgb(0 0 0 / 0.22)'
			: '0 1px 4px rgb(0 0 0 / 0.3)'}
	aria-label="Comment #{thread.id} by {root.author.name}: {text}"
	aria-expanded={open}
	in:pop={{ duration: 240, easing: backOut }}
	out:pop={{ duration: 140, easing: cubicIn }}
	onpointerenter={() => (hovered = true)}
	onpointerleave={() => (hovered = false)}
	onfocus={() => (focused = true)}
	onblur={() => (focused = false)}
	onclick={onopen}
>
	<Avatar
		user={root.author}
		size={24}
		class="pf-pin-avatar absolute"
	/>
	<span
		class="pf-pin-text absolute top-2.5 left-[42px] block w-max max-w-[240px] text-[13px] leading-[18px] text-pf-ink"
		style:opacity={expanded ? 1 : 0}
		bind:offsetWidth={textWidth}
		bind:offsetHeight={textHeight}
		aria-hidden="true"
	>
		<span class="block truncate whitespace-nowrap">
			<span class="font-medium">{root.author.name}</span>
			<span class="ml-1 text-pf-muted">{ago(root.createdAt, now)}</span>
		</span>
		<span class="line-clamp-2 block break-words whitespace-pre-line">{text}</span>
		{#if replies > 0}
			<span class="mt-0.5 block text-xs text-pf-muted">{replies} {replies === 1 ? 'reply' : 'replies'}</span>
		{/if}
	</span>
	{#if thread.unread}
		<span class="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-pf-comment ring-2 ring-white"></span>
	{/if}
</button>

<style>
	.pf-pin {
		transform: translateY(-100%);
		transition:
			width 220ms cubic-bezier(0.2, 0.9, 0.3, 1),
			height 220ms cubic-bezier(0.2, 0.9, 0.3, 1),
			border-radius 220ms ease,
			box-shadow 160ms ease,
			opacity 160ms ease;
	}
	.pf-pin :global(.pf-pin-avatar) {
		top: 4px;
		left: 4px;
		transition: top 220ms cubic-bezier(0.2, 0.9, 0.3, 1), left 220ms cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	.pf-pin-expanded :global(.pf-pin-avatar) {
		top: 10px;
		left: 10px;
	}
	.pf-pin-text {
		transition: opacity 140ms ease 60ms;
	}
	@media (prefers-reduced-motion: reduce) {
		.pf-pin,
		.pf-pin :global(.pf-pin-avatar),
		.pf-pin-text {
			transition: none;
		}
	}
</style>
