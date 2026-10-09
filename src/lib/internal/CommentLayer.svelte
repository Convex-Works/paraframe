<!--
  Pins, the new-comment field and the open thread, drawn over frames. The host
  maps frame positions to this layer's pixels and says which part is visible,
  so cards can open on whichever side of a pin has room. It also outlines the
  element the pointer is aiming at, the new comment's element and the open
  thread's.
-->
<script lang="ts" module>
	import type { Box, CommentAim, CommentTarget } from './comment-target.js';

	export interface CommentDraft extends CommentAim {
		text: string;
		/** Narrower targets the pin was widened from, innermost first. */
		inner?: CommentTarget[];
		/** Images added so far, so a click elsewhere keeps them like text. */
		images?: number;
	}

	export interface LayerBounds {
		left: number;
		top: number;
		right: number;
		bottom: number;
	}
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { useAuth } from '../auth.js';
	import { useComments, type CommentImage, type CommentThread } from '../comments.js';
	import { isFrameMessage } from '../messages.js';
	import CommentComposer from './CommentComposer.svelte';
	import CommentPin from './CommentPin.svelte';
	import CommentThreadCard from './CommentThreadCard.svelte';
	import Icon from './Icon.svelte';
	import { threadLink } from './comment-links.js';
	import { anchorOf, locate, MAGNET, reveal, widen } from './comment-target.js';
	import { neck } from './metaball.js';
	import type { Prototype } from '../types.js';

	let {
		prototype,
		place,
		bounds,
		aim,
		cursor,
		documentOf,
		draft = $bindable()
	}: {
		prototype: Prototype;
		/** Where a point on a frame appears in this layer, or undefined if that frame is not shown. */
		place: (frame: string, x: number, y: number) => { left: number; top: number } | undefined;
		bounds: LayerBounds;
		/** Where the pointer is aiming in comment mode, while a click would start a thread. */
		aim?: CommentAim;
		/**
		 * The pointer in client pixels while the host hides the system cursor. The
		 * comment cursor is drawn here instead, so it can fade out over an element.
		 */
		cursor?: { x: number; y: number };
		/** A frame's live document, if loaded, so pins on its elements follow them. */
		documentOf?: (frame: string) => Document | undefined;
		draft?: CommentDraft;
	} = $props();

	const comments = useComments()!;
	const auth = useAuth();
	const PIN = 32;
	const GAP = 10;
	const EDGE = 8;
	const CARD_WIDTH = 320;
	const COMPOSER_WIDTH = 296;

	let layer = $state<HTMLDivElement>();
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

	// Bumped when a frame reports that it scrolled, resized or changed.
	let layout = $state(0);
	onMount(() => {
		const onmessage = (event: MessageEvent) => {
			if (event.origin !== location.origin || !isFrameMessage(event.data)) return;
			if (event.data.type === 'paraframe:layout' || event.data.type === 'paraframe:ready') layout++;
		};
		window.addEventListener('message', onmessage);
		return () => window.removeEventListener('message', onmessage);
	});

	/**
	 * Where a thread's pin is now, in frame pixels. A pin on an element moves
	 * with it and hides while it is out of view; a free pin, or one on a frame
	 * not loaded live (an image preview), stays where it was placed.
	 */
	function spot(thread: CommentThread) {
		void layout;
		const doc = thread.anchor ? documentOf?.(thread.frame) : undefined;
		if (!doc || !thread.anchor) return { x: thread.x, y: thread.y, hidden: false };
		const found = locate(doc, thread.anchor, thread);
		// Gone from a live frame (another tab, filtered out): not in view either.
		if (!found) return { x: thread.x, y: thread.y, hidden: true };
		return { x: found.x, y: found.y, box: found.box, element: found.element, hidden: !found.visible };
	}

	// Opening a thread scrolls its element into view inside the frame, once the frame has loaded.
	let revealing = $state<number>();
	$effect(() => {
		revealing = comments.openId;
	});
	$effect(() => {
		void layout;
		const id = revealing;
		if (id === undefined) return;
		untrack(() => {
			const thread = comments.threads.find((t) => t.id === id);
			if (!thread?.anchor) return void (revealing = undefined);
			if (!documentOf?.(thread.frame)) return;
			const where = spot(thread);
			if (where.element && where.hidden) reveal(where.element);
			revealing = undefined;
		});
	});

	const margin = 48;
	const pins = $derived(comments.pinned.flatMap((thread) => {
		const where = spot(thread);
		if (where.hidden) return [];
		const at = anchor(thread.frame, where.x, where.y);
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
		const where = thread && spot(thread);
		const at = thread && where && anchor(thread.frame, where.x, where.y);
		return thread && where && at ? { thread, where, at, card: beside(at, CARD_WIDTH, cardHeight) } : undefined;
	});

	/** A frame box in this layer's pixels, with a little room around it. */
	function outline(frame: string, box: Box, radius = 0) {
		const a = place(frame, box.x, box.y);
		const b = place(frame, box.x + box.width, box.y + box.height);
		const unit = place(frame, box.x + 1, box.y);
		if (!a || !b || !unit) return undefined;
		const pad = 3;
		return {
			left: a.left - pad,
			top: a.top - pad,
			width: b.left - a.left + pad * 2,
			height: b.top - a.top + pad * 2,
			radius: radius * (unit.left - a.left) + pad
		};
	}

	const aiming = $derived.by(() => {
		if (!aim?.target) return undefined;
		const shape = outline(aim.frame, aim.target.box, aim.target.radius);
		if (!shape) return undefined;
		// Like a pointer resting on a button, the outline leans a little toward the pointer.
		const { box } = aim.target;
		const lean = (offset: number, size: number) => Math.max(-1, Math.min(1, offset / (size / 2 || 1))) * 3;
		return {
			...shape,
			dx: lean(aim.point.x - (box.x + box.width / 2), box.width),
			dy: lean(aim.point.y - (box.y + box.height / 2), box.height)
		};
	});

	/**
	 * Over an element the cursor becomes a faint dot, joined to the outline
	 * while the pointer is outside it. In client pixels, like the cursor.
	 */
	const DOT = 4;
	const dot = $derived.by(() => {
		if (!cursor || !aiming || !layer) return undefined;
		const origin = layer.getBoundingClientRect();
		const box = {
			left: origin.left + aiming.left + aiming.dx,
			top: origin.top + aiming.top + aiming.dy,
			width: aiming.width,
			height: aiming.height,
			radius: aiming.radius
		};
		return { ...cursor, neck: neck(cursor.x, cursor.y, DOT, box, MAGNET + 8) };
	});

	/** The new comment's element where it is now, following any scroll since the click. */
	const draftBox = $derived.by(() => {
		void layout;
		const target = draft?.target;
		if (!target) return undefined;
		if (!target.element.isConnected) return target.box;
		const r = target.element.getBoundingClientRect();
		return { x: r.left, y: r.top, width: r.width, height: r.height };
	});
	const drafted = $derived(draft?.target && draftBox && outline(draft.frame, draftBox, draft.target.radius));
	const wider = $derived(draft?.target && widen(draft.target));
	const anchored = $derived(
		open?.thread.anchor && !open.where.hidden && outline(open.thread.frame, open.where.box ?? open.thread.anchor)
	);
	/** The new comment's element, or else the open thread's. */
	const marked = $derived(drafted || (draft ? undefined : anchored));

	function widenDraft() {
		if (!draft?.target || !wider) return;
		draft.inner = [draft.target, ...(draft.inner ?? [])];
		draft.target = wider;
		composer?.focus();
	}

	function narrowDraft() {
		const [inner, ...rest] = draft?.inner ?? [];
		if (!draft || !inner) return;
		draft.target = inner;
		draft.inner = rest;
		composer?.focus();
	}

	/** Leaves the element and pins the comment where the pointer was. */
	function detachDraft() {
		if (!draft) return;
		draft.x = draft.point.x;
		draft.y = draft.point.y;
		draft.target = undefined;
		draft.inner = undefined;
		composer?.focus();
	}

	function onDraftKeydown(event: KeyboardEvent) {
		if (!event.altKey || event.metaKey || event.ctrlKey) return;
		if (event.key === 'ArrowUp') widenDraft();
		else if (event.key === 'ArrowDown') narrowDraft();
		else return;
		event.preventDefault();
	}

	const pending = $derived.by(() => {
		const box = draft?.target && draftBox;
		const x = draft && (box ? box.x + draft.x - draft.target!.box.x : draft.x);
		const y = draft && (box ? box.y + draft.y - draft.target!.box.y : draft.y);
		const at = draft && anchor(draft.frame, x!, y!);
		return at ? { at, card: beside({ left: at.left, top: at.top + 4 }, COMPOSER_WIDTH, 40) } : undefined;
	});

	async function submitDraft(body: string, images: CommentImage[]) {
		if (!draft) return;
		try {
			const anchor = draft.target && anchorOf(draft.target);
			const thread = await comments.create(draft.frame, draft.x, draft.y, body, anchor, images);
			draft = undefined;
			comments.openThread(thread.id);
		} catch (error) {
			comments.error = (error as Error).message;
			throw error;
		}
	}
</script>

<div bind:this={layer} class="pointer-events-none absolute inset-0">
	{#if cursor}
		<!-- The .pf-comment-cursor image, drawn. Its hotspot is the bottom-left point. -->
		<svg
			class={['pf-cursor', aiming && 'pf-cursor-hidden']}
			style:left="{cursor.x - 1}px"
			style:top="{cursor.y - 27}px"
			width="28"
			height="28"
			viewBox="0 0 28 28"
			aria-hidden="true"
		>
			<path d="M14 1.5a12.5 12.5 0 1 1 0 25H1.5V14A12.5 12.5 0 0 1 14 1.5z" fill="white" stroke="#1c1917" stroke-width="1.5" />
			<path d="M14 9v10M9 14h10" stroke="#1c1917" stroke-width="1.5" stroke-linecap="round" />
		</svg>
	{/if}
	{#if dot}
		<svg class="pf-dot" aria-hidden="true">
			<g>
				{#if dot.neck}<path d={dot.neck} />{/if}
				<circle cx={dot.x} cy={dot.y} r={DOT} />
			</g>
		</svg>
	{/if}
	{#if aiming}
		<span
			class="pf-target pf-target-aim absolute"
			style:left="{aiming.left}px"
			style:top="{aiming.top}px"
			style:width="{aiming.width}px"
			style:height="{aiming.height}px"
			style:border-radius="{aiming.radius}px"
			style:translate="{aiming.dx}px {aiming.dy}px"
			aria-hidden="true"
		></span>
	{/if}
	{#if marked}
		<span
			class={['pf-target absolute', !drafted && 'pf-target-quiet']}
			style:left="{marked.left}px"
			style:top="{marked.top}px"
			style:width="{marked.width}px"
			style:height="{marked.height}px"
			style:border-radius="{marked.radius}px"
			aria-hidden="true"
		></span>
	{/if}

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
		<!-- Alt+Up and Alt+Down from the field widen or narrow the comment's element. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			data-pf-ui
			class={['pointer-events-auto absolute z-40 cursor-default', shake && 'pf-shake']}
			style:left="{pending.card.left}px"
			style:top="{pending.card.top}px"
			role="group"
			aria-label="New comment"
			onanimationend={() => (shake = false)}
			onkeydown={onDraftKeydown}
		>
			{#if comments.viewer}
				<CommentComposer
					bind:this={composer}
					variant="new"
					placeholder="Add a comment"
					initial={draft.text}
					autofocus
					oninput={(text) => { if (draft) draft.text = text; }}
					onimages={(count) => { if (draft) draft.images = count; }}
					onsubmit={submitDraft}
					oncancel={() => (draft = undefined)}
				/>
				{#if draft.target}
					<div class="mt-1.5 flex w-fit max-w-[296px] items-center rounded-full bg-white py-0.5 pr-0.5 pl-3 text-xs text-pf-muted shadow-[0_1px_6px_rgb(0_0_0/0.16)]">
						<span class="min-w-0 truncate pr-1" title={draft.target.label}>On {draft.target.label}</span>
						{#if draft.inner?.length}
							<button type="button" class="pf-target-tool" aria-label="Select the element inside" title="Inside (⌥↓)" onclick={narrowDraft}>
								<Icon name="chevron-down" size={14} />
							</button>
						{/if}
						{#if wider}
							<button type="button" class="pf-target-tool" aria-label="Select the element around it" title="Around it (⌥↑)" onclick={widenDraft}>
								<Icon name="chevron-up" size={14} />
							</button>
						{/if}
						<button type="button" class="pf-target-tool" aria-label="Pin to the point instead" title="Pin to the point instead" onclick={detachDraft}>
							<Icon name="close" size={14} />
						</button>
					</div>
				{/if}
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
	.pf-cursor {
		position: fixed;
		z-index: 50;
		transform-origin: 1px 27px;
		transition: opacity 140ms ease, scale 140ms ease;
	}
	.pf-cursor-hidden {
		opacity: 0;
		scale: 0.6;
	}
	.pf-dot {
		position: fixed;
		inset: 0;
		z-index: 50;
		width: 100%;
		height: 100%;
		overflow: visible;
		animation: pf-dot-in 140ms ease;
	}
	/* One group, so where the neck overlaps the dot it is not darker. */
	.pf-dot g {
		fill: var(--pf-comment);
		opacity: 0.5;
	}
	@keyframes pf-dot-in {
		from {
			opacity: 0;
		}
	}
	.pf-target {
		border: 2px solid var(--pf-comment);
		background: color-mix(in srgb, var(--pf-comment) 8%, transparent);
	}
	.pf-target-aim {
		transition-property: left, top, width, height, border-radius, translate;
		transition-duration: 110ms, 110ms, 110ms, 110ms, 110ms, 60ms;
		transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
		animation: pf-target-in 110ms ease-out;
	}
	@keyframes pf-target-in {
		from {
			opacity: 0;
			scale: 1.06;
		}
	}
	.pf-target-quiet {
		border: 1.5px dashed var(--pf-comment);
		background: none;
	}
	.pf-target-tool {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		color: var(--pf-muted);
	}
	.pf-target-tool:hover {
		background: var(--pf-wash);
		color: var(--pf-ink);
	}
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
		.pf-shake,
		.pf-target-aim,
		.pf-cursor,
		.pf-dot {
			animation: none;
			transition: none;
		}
	}
</style>
