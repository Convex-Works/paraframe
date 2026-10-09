<!--
  Shows one frame at a time, scaled to the window, like a design tool's
  prototype view. Links inside frames move between frames; arrow keys step
  through frames in reading order.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from './internal/Icon.svelte';
	import AccountMenu from './internal/AccountMenu.svelte';
	import CommentLayer, { type CommentDraft } from './internal/CommentLayer.svelte';
	import CommentsPanel from './internal/CommentsPanel.svelte';
	import { CommentAimer, type Pointer } from './internal/comment-aim.svelte.js';
	import { aimAt, frameDocument, MAGNET, scrollerAt } from './internal/comment-target.js';
	import Menu from './internal/Menu.svelte';
	import MenuItem from './internal/MenuItem.svelte';
	import { readStored, storageKey, writeStored } from './internal/storage.js';
	import { isEditable, isFrameMessage, PLAYER_KEYS } from './messages.js';
	import { useComments, type CommentThread } from './comments.js';
	import type { Flow, Prototype } from './types.js';

	let { prototype, frameId }: { prototype: Prototype; frameId: string } = $props();

	type Scale = 'fit' | 'width' | 'actual';
	const SCALES: { value: Scale; label: string }[] = [
		{ value: 'fit', label: 'Fit to window' },
		{ value: 'width', label: 'Fit width' },
		{ value: 'actual', label: 'Actual size' }
	];
	const GUTTER = 32;

	const frame = $derived(prototype.get(frameId));
	const keys = $derived({
		scale: storageKey(prototype.title, 'scale'),
		flow: storageKey(prototype.title, 'flow'),
		last: storageKey(prototype.title, 'last')
	});

	let scaleMode = $state<Scale>('fit');
	let flowId = $state<string | undefined>();
	let stageWidth = $state(0);
	let stageHeight = $state(0);

	const flow = $derived(prototype.flows.find((f) => f.id === flowId));

	const comments = useComments();
	const commenting = $derived(comments?.active ?? false);
	let draft = $state<CommentDraft>();
	let commentLayer = $state<CommentLayer>();
	let stage = $state<HTMLElement>();
	let sheet = $state<HTMLElement>();
	let catcher = $state<HTMLElement>();
	let scroll = $state(0);

	const view = $derived.by(() => {
		const { width, height } = frame?.size ?? prototype.size;
		if (!stageWidth || !stageHeight) return { scale: 1, height };
		if (scaleMode === 'actual') return { scale: 1, height };
		if (scaleMode === 'width') {
			const scale = stageWidth / width;
			return { scale, height: Math.max(height, stageHeight / scale) };
		}
		const scale = Math.min(
			(stageWidth - GUTTER * 2) / width,
			(stageHeight - GUTTER * 2) / height,
			1
		);
		return { scale: Math.max(scale, 0.05), height };
	});

	// Two iframes overlap while the next frame loads, so navigation never flashes blank.
	type Slot = { key: number; id: string; ready: boolean };
	let nextKey = 1;
	let slots = $state<Slot[]>(untrack(() => [{ key: 0, id: frameId, ready: true }]));
	const iframes = new Map<number, HTMLIFrameElement>();

	$effect(() => {
		const id = frameId;
		untrack(() => {
			if (slots.at(-1)?.id === id) return;
			slots.push({ key: nextKey++, id, ready: false });
		});
	});

	function markReady(key: number) {
		const index = slots.findIndex((s) => s.key === key);
		if (index === -1) return;
		slots[index].ready = true;
		if (index > 0) slots = slots.slice(index);
	}

	$effect(() => {
		scaleMode = readStored('local', keys.scale, 'fit');
		flowId = readStored('session', keys.flow, undefined);
	});

	$effect(() => writeStored('session', keys.last, frameId));

	function setScale(value: Scale) {
		scaleMode = value;
		writeStored('local', keys.scale, value);
	}

	function show(id: string | undefined) {
		if (id && prototype.get(id) && id !== frameId) {
			goto(prototype.paths.play(id), { reset: false });
		}
	}

	function startFlow(next: Flow) {
		flowId = next.id;
		writeStored('session', keys.flow, next.id);
		show(next.start);
	}

	function restart() {
		if (flow) show(flow.start);
	}

	function handleKey(key: string) {
		if (key === 'ArrowRight') show(prototype.next(frameId)?.id);
		else if (key === 'ArrowLeft') show(prototype.prev(frameId)?.id);
		else if ((key === 'r' || key === 'R') && flow) restart();
		else if (key === 'c' || key === 'C') setCommenting(!commenting);
	}

	function setCommenting(on: boolean) {
		if (!comments) return;
		comments.active = on;
		// The click catcher appears or goes under a still pointer; wait for it to move.
		aimer.move(undefined);
		if (!on) {
			draft = undefined;
			comments.openThread(undefined);
		}
	}

	// Leaving a frame discards an empty new comment on it.
	$effect(() => {
		if (draft && draft.frame !== frameId) untrack(() => (draft = undefined));
	});

	/** The shown frame's document, once it has loaded. */
	function documentOf(id: string) {
		const top = slots.at(-1);
		return top?.id === id && top.ready ? frameDocument(iframes.get(top.key), id) : undefined;
	}

	// Where a click would pin, pulled onto the element near the pointer. Alt pins anywhere.
	function aimFor(pointer: Pointer) {
		if (!frame || !catcher) return undefined;
		const rect = catcher.getBoundingClientRect();
		return aimAt(
			frame.id,
			(pointer.clientX - rect.left) / view.scale,
			(pointer.clientY - rect.top) / view.scale,
			pointer.altKey ? undefined : documentOf(frame.id),
			MAGNET / view.scale
		);
	}

	// The click catcher covers the frame in comment mode; pass wheel turns to
	// whatever scrolls inside the frame under the pointer, so long pages and
	// tables can still be read. Otherwise the stage scrolls as usual.
	function forwardWheel(node: HTMLElement) {
		const onwheel = (event: WheelEvent) => {
			const doc = frame && documentOf(frame.id);
			if (!doc) return;
			const rect = node.getBoundingClientRect();
			const unit = event.deltaMode === 1 ? 16 : 1;
			const dx = (event.deltaX * unit) / view.scale;
			const dy = (event.deltaY * unit) / view.scale;
			const scroller = scrollerAt(doc, (event.clientX - rect.left) / view.scale, (event.clientY - rect.top) / view.scale, dx, dy);
			if (!scroller) return;
			event.preventDefault();
			scroller.scrollBy(dx, dy);
		};
		node.addEventListener('wheel', onwheel, { passive: false });
		return () => node.removeEventListener('wheel', onwheel);
	}

	const aimer = new CommentAimer((pointer) =>
		commenting && !draft && comments?.openId === undefined ? aimFor(pointer) : undefined
	);

	$effect(() => {
		void [view, scroll, frame, slots.at(-1)?.ready, commenting, draft, comments?.openId];
		aimer.update();
	});

	// In comment mode a click on the frame starts a thread; a click away from an open thread closes it.
	function placeComment(event: MouseEvent) {
		if (!comments || !frame) return;
		if (draft?.text.trim() || draft?.images) {
			commentLayer?.focusDraft();
			return;
		}
		if (comments.openId !== undefined) {
			comments.openThread(undefined);
			return;
		}
		const aim = aimFor(event);
		draft = aim && { ...aim, text: '' };
	}

	function focusThread(thread: CommentThread) {
		if (!comments) return;
		draft = undefined;
		comments.openThread(thread.id);
		if (thread.frame !== frameId) show(thread.frame);
	}

	// The part of the stage in view, in the frame's own coordinates, so open threads stay on screen.
	const commentBounds = $derived.by(() => {
		void [scroll, view, frame, stageWidth, stageHeight];
		if (!stage || !sheet) return { left: 0, top: 0, right: 0, bottom: 0 };
		const outer = stage.getBoundingClientRect();
		const inner = sheet.getBoundingClientRect();
		return {
			left: outer.left - inner.left,
			top: outer.top - inner.top,
			right: outer.left - inner.left + stageWidth,
			bottom: outer.top - inner.top + stageHeight
		};
	});

	function onkeydown(event: KeyboardEvent) {
		aimer.key(event);
		if (event.key === 'Escape' && comments && !isEditable(event.target) && !document.querySelector(':popover-open')) {
			if (draft) draft = undefined;
			else if (comments.openId !== undefined) comments.openThread(undefined);
			else if (commenting) setCommenting(false);
			return;
		}
		if (!PLAYER_KEYS.has(event.key)) return;
		if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
		if (document.querySelector(':popover-open')) return;
		event.preventDefault();
		handleKey(event.key);
	}

	function onmessage(event: MessageEvent) {
		if (event.origin !== location.origin || !isFrameMessage(event.data)) return;
		const key = [...iframes].find(([, el]) => el.contentWindow === event.source)?.[0];
		if (key === undefined) return;
		const message = event.data;
		if (message.type === 'paraframe:ready') markReady(key);
		// Only the frame on top may navigate; a frame still fading out may not.
		else if (key === slots.at(-1)?.key) {
			if (message.type === 'paraframe:navigate') show(message.to);
			else if (message.type === 'paraframe:key') handleKey(message.key);
			// The frame scrolled under a still pointer: aim again.
			else aimer.update();
		}
	}

	function track(key: number) {
		return (el: HTMLIFrameElement) => {
			iframes.set(key, el);
			return () => iframes.delete(key);
		};
	}

	// Fallback for frames that never report ready.
	function onload(key: number) {
		setTimeout(() => markReady(key), 1500);
	}
</script>

<svelte:window {onkeydown} onkeyup={(event) => aimer.key(event)} {onmessage} />

<div class="pf-root flex h-dvh flex-col bg-pf-stage font-pf text-[13px] text-pf-canvas-ink">
	<header class="pf-toolbar z-20 m-3 mb-0 shrink-0">
		<div class="pf-island pr-4">
			<a
				href={prototype.paths.canvas()}
				class="pf-tool"
				title="All frames (canvas)"
				aria-label="All frames (canvas)"
			>
				<Icon name="canvas" />
			</a>
			<p class="flex min-w-0 items-baseline gap-1.5 pl-1">
				{#if frame}
					<span class="hidden shrink-0 text-pf-island-muted sm:inline">{frame.section.title}</span>
					<span class="hidden text-pf-island-muted sm:inline" aria-hidden="true">/</span>
				{/if}
				<span class="truncate font-medium">{frame?.title ?? frameId}</span>
			</p>
		</div>

		<div class="pf-island ml-auto flex-wrap justify-end">
			<nav class="flex items-center gap-1" aria-label="Step through frames">
				<button
					type="button"
					class="pf-tool"
					onclick={() => handleKey('ArrowLeft')}
					disabled={!prototype.prev(frameId)}
					title="Previous frame (←)"
					aria-label="Previous frame"
				>
					<Icon name="chevron-left" />
				</button>
				<span class="min-w-16 text-center text-pf-island-muted tabular-nums">
					{(frame?.index ?? 0) + 1} of {prototype.frames.length}
				</span>
				<button
					type="button"
					class="pf-tool"
					onclick={() => handleKey('ArrowRight')}
					disabled={!prototype.next(frameId)}
					title="Next frame (→)"
					aria-label="Next frame"
				>
					<Icon name="chevron-right" />
				</button>
			</nav>

			{#if prototype.flows.length}
				<Menu label="Flows" align="end" class="pf-tool gap-1.5 px-3">
					{#snippet trigger()}
						<span class="max-w-48 truncate">{flow?.title ?? 'Flows'}</span>
						<Icon name="chevron-down" size={14} />
					{/snippet}
					{#snippet children(close)}
						{#each prototype.flows as item (item.id)}
							<MenuItem
								checked={item.id === flowId}
								onselect={() => {
									close();
									startFlow(item);
								}}
							>
								{item.title}
							</MenuItem>
						{/each}
					{/snippet}
				</Menu>
			{/if}

			{#if comments}
				<button
					type="button"
					class="pf-tool relative"
					aria-pressed={commenting}
					aria-label="Comments"
					title="Comments (C)"
					onclick={() => setCommenting(!commenting)}
				>
					<Icon name="comment" />
					{#if comments.unreadCount && !commenting}
						<span class="absolute top-1 right-1 size-2 rounded-full bg-pf-comment"></span>
					{/if}
				</button>
			{/if}

			{#if flow}
				<button
					type="button"
					class="pf-tool"
					onclick={restart}
					title="Restart “{flow.title}” (R)"
					aria-label="Restart “{flow.title}”"
				>
					<Icon name="restart" />
				</button>
			{/if}

			<Menu label="Jump to a frame" align="end" class="pf-tool gap-1.5 px-3">
				{#snippet trigger()}
					<span>Frames</span>
					<Icon name="chevron-down" size={14} />
				{/snippet}
				{#snippet children(close)}
					{#each prototype.sections as section (section.id)}
						<p class="px-2 pt-2 pb-1 text-xs text-pf-muted">{section.title}</p>
						{#each section.frames as item (item.id)}
							<MenuItem
								checked={item.id === frameId}
								onselect={() => {
									close();
									show(item.id);
								}}
							>
								{item.title}
							</MenuItem>
						{/each}
					{/each}
				{/snippet}
			</Menu>

			<Menu label="Scale" align="end" class="pf-tool gap-1.5 px-3">
				{#snippet trigger()}
					<span class="tabular-nums">{Math.round(view.scale * 100)}%</span>
					<Icon name="chevron-down" size={14} />
				{/snippet}
				{#snippet children(close)}
					{#each SCALES as option (option.value)}
						<MenuItem
							checked={option.value === scaleMode}
							onselect={() => {
								close();
								setScale(option.value);
							}}
						>
							{option.label}
						</MenuItem>
					{/each}
				{/snippet}
			</Menu>

			<a
				href={prototype.paths.frame(frameId)}
				target="_blank"
				rel="noopener"
				class="pf-tool"
				title="Open this frame on its own"
				aria-label="Open this frame on its own"
			>
				<Icon name="external" />
			</a>
			<AccountMenu />
		</div>
	</header>

	<div class="flex min-h-0 flex-1">
	<main
		bind:this={stage}
		class="flex min-h-0 flex-1 overflow-auto"
		bind:clientWidth={stageWidth}
		bind:clientHeight={stageHeight}
		onscroll={() => scroll++}
	>
		{#if frame}
			<div
				bind:this={sheet}
				class="relative m-auto shrink-0"
				style:width="{frame.size.width * view.scale}px"
				style:height="{view.height * view.scale}px"
			>
			<div class={['absolute inset-0 overflow-hidden bg-white', scaleMode !== 'width' && 'rounded-md']}>
				{#each slots as slot (slot.key)}
					{@const shown = prototype.get(slot.id)}
					{#if shown}
						<iframe
							{@attach track(slot.key)}
							data-pf-player
							allow="clipboard-read; clipboard-write; fullscreen"
							src={prototype.paths.frame(slot.id)}
							title={shown.title}
							onload={() => onload(slot.key)}
							class="absolute top-0 left-0 origin-top-left border-0 bg-white"
							style:width="{shown.size.width}px"
							style:height="{view.height}px"
							style:transform="scale({view.scale})"
							style:opacity={slot.ready ? 1 : 0}
						></iframe>
					{/if}
				{/each}
			</div>
			{#if comments}
				{#if commenting}
					<!-- Catches clicks meant for a new comment before they reach the frame. -->
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						bind:this={catcher}
						{@attach forwardWheel}
						class={['absolute inset-0', aimer.cursor ? 'cursor-none' : 'pf-comment-cursor']}
						role="presentation"
						onclick={placeComment}
						onpointermove={(event) => aimer.move(event)}
						onpointerleave={() => aimer.move(undefined)}
					></div>
				{/if}
				<CommentLayer
					bind:this={commentLayer}
					bind:draft
					{prototype}
					aim={aimer.aim}
					cursor={commenting ? aimer.cursor : undefined}
					{documentOf}
					place={(id, x, y) => (id === frame.id ? { left: x * view.scale, top: y * view.scale } : undefined)}
					bounds={commentBounds}
				/>
			{/if}
			</div>
		{:else}
			<p class="m-auto text-pf-canvas-muted">
				No frame “{frameId}”. <a class="underline" href={prototype.paths.canvas()}>Open the canvas</a>
			</p>
		{/if}
	</main>
	{#if comments && commenting}
		<CommentsPanel
			{prototype}
			class="my-3 mr-3 w-80 shrink-0"
			onselect={focusThread}
			onclose={() => setCommenting(false)}
		/>
	{/if}
	</div>
</div>
