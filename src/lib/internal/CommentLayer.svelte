<!--
  Pins, the new-comment field and the open thread, drawn over frames. The host
  maps frame positions to this layer's pixels and says which part is visible,
  so cards can open on whichever side of a pin has room.
-->
<script lang="ts" module>
	export interface CommentDraft {
		frame: string;
		x: number;
		y: number;
		text: string;
	}

	export interface LayerBounds {
		left: number;
		top: number;
		right: number;
		bottom: number;
	}
</script>

<script lang="ts">
	import { useAuth } from '../auth.js';
	import { useComments } from '../comments.js';
	import CommentComposer from './CommentComposer.svelte';
	import CommentPin from './CommentPin.svelte';
	import CommentThreadCard from './CommentThreadCard.svelte';
	import { threadLink } from './comment-links.js';
	import type { Prototype } from '../types.js';

	let {
		prototype,
		place,
		bounds,
		draft = $bindable()
	}: {
		prototype: Prototype;
		/** Where a point on a frame appears in this layer, or undefined if that frame is not shown. */
		place: (frame: string, x: number, y: number) => { left: number; top: number } | undefined;
		bounds: LayerBounds;
		draft?: CommentDraft;
	} = $props();

	const comments = useComments()!;
	const auth = useAuth();
	const PIN = 32;
	const GAP = 10;
	const EDGE = 8;
	const CARD_WIDTH = 320;
	const COMPOSER_WIDTH = 296;

	let composer = $state<CommentComposer>();
	let cardHeight = $state(0);
	let shake = $state(false);

	/** Brings the unsent comment back to attention instead of discarding it. */
	export function focusDraft() {
		composer?.focus();
		shake = false;
		requestAnimationFrame(() => (shake = true));
	}

	function anchor(frame: string, x: number, y: number) {
		const size = prototype.get(frame)?.size;
		if (!size) return undefined;
		// Frames can shrink after a comment is placed; keep its pin on the frame.
		return place(frame, Math.min(x, size.width), Math.min(y, size.height));
	}

	const margin = 48;
	const pins = $derived(comments.pinned.flatMap((thread) => {
		const at = anchor(thread.frame, thread.x, thread.y);
		if (!at || at.left < bounds.left - margin || at.left > bounds.right + margin
			|| at.top < bounds.top - margin || at.top > bounds.bottom + margin) return [];
		return [{ thread, ...at }];
	}));

	/** Beside the pin, on the side with room, kept inside the visible area. */
	function beside(at: { left: number; top: number }, width: number, height: number) {
		let left = at.left + PIN + GAP;
		if (left + width > bounds.right - EDGE) left = at.left - GAP - width;
		left = Math.max(bounds.left + EDGE, Math.min(left, bounds.right - EDGE - width));
		const top = Math.max(bounds.top + EDGE, Math.min(at.top - PIN, bounds.bottom - EDGE - height));
		return { left, top };
	}

	const open = $derived.by(() => {
		const thread = comments.open;
		const at = thread && anchor(thread.frame, thread.x, thread.y);
		return thread && at ? { thread, at, card: beside(at, CARD_WIDTH, cardHeight) } : undefined;
	});

	const pending = $derived.by(() => {
		const at = draft && anchor(draft.frame, draft.x, draft.y);
		return at ? { at, card: beside({ left: at.left, top: at.top + 4 }, COMPOSER_WIDTH, 40) } : undefined;
	});

	async function submitDraft(body: string) {
		if (!draft) return;
		try {
			const thread = await comments.create(draft.frame, draft.x, draft.y, body);
			draft = undefined;
			comments.openThread(thread.id);
		} catch (error) {
			comments.error = (error as Error).message;
			throw error;
		}
	}
</script>

<div class="pointer-events-none absolute inset-0">
	{#each pins as pin (pin.thread.id)}
		<CommentPin
			thread={pin.thread}
			left={pin.left}
			top={pin.top}
			now={comments.now}
			open={pin.thread.id === comments.openId}
			onopen={() => {
				draft = undefined;
				comments.openThread(pin.thread.id === comments.openId ? undefined : pin.thread.id);
			}}
		/>
	{/each}

	{#if pending && draft}
		<span
			class="pf-draft-pin absolute z-20 block size-8 bg-pf-comment shadow-[0_1px_4px_rgb(0_0_0/0.3)]"
			style:left="{pending.at.left}px"
			style:top="{pending.at.top}px"
			aria-hidden="true"
		></span>
		<div
			data-pf-ui
			class={['pointer-events-auto absolute z-40 cursor-default', shake && 'pf-shake']}
			style:left="{pending.card.left}px"
			style:top="{pending.card.top}px"
			onanimationend={() => (shake = false)}
		>
			{#if comments.viewer}
				<CommentComposer
					bind:this={composer}
					variant="new"
					placeholder="Add a comment"
					initial={draft.text}
					autofocus
					oninput={(text) => { if (draft) draft.text = text; }}
					onsubmit={submitDraft}
					oncancel={() => (draft = undefined)}
				/>
			{:else}
				<div class="flex w-[296px] items-center gap-3 rounded-[18px] bg-white py-2 pr-2 pl-4 text-[13px] text-pf-ink shadow-[0_2px_14px_rgb(0_0_0/0.18)]">
					<p class="flex-1">Sign in to comment.</p>
					{#if auth?.configured}
						<button type="button" class="h-7 rounded-full bg-pf-comment px-3 font-medium text-white hover:brightness-110"
							onclick={() => auth.signIn()}>Sign in</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if open}
		<div
			class="absolute z-40"
			style:left="{open.card.left}px"
			style:top="{open.card.top}px"
			bind:offsetHeight={cardHeight}
		>
			<CommentThreadCard
				thread={open.thread}
				frameTitle={prototype.get(open.thread.frame)?.title ?? open.thread.frame}
				link={threadLink(prototype, open.thread.id)}
				maxHeight={Math.max(200, bounds.bottom - bounds.top - EDGE * 2)}
				onclose={() => comments.openThread(undefined)}
			/>
		</div>
	{/if}
</div>

<style>
	.pf-draft-pin {
		border-radius: 16px 16px 16px 0;
		transform: translateY(-100%);
		animation: pf-drop 180ms cubic-bezier(0.2, 0.9, 0.3, 1.3);
		transform-origin: bottom left;
	}
	@keyframes pf-drop {
		from {
			transform: translateY(-100%) scale(0.4);
			opacity: 0;
		}
	}
	.pf-shake {
		animation: pf-shake 320ms ease;
	}
	@keyframes pf-shake {
		20%, 60% { translate: -6px 0; }
		40%, 80% { translate: 6px 0; }
	}
	@media (prefers-reduced-motion: reduce) {
		.pf-draft-pin,
		.pf-shake {
			animation: none;
		}
	}
</style>
