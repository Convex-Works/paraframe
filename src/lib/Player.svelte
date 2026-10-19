<!--
  Shows one frame at a time, scaled to the window, like a design tool's
  prototype view. Links inside frames move between frames; arrow keys step
  through frames in reading order.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from './internal/Icon.svelte';
	import Menu from './internal/Menu.svelte';
	import MenuItem from './internal/MenuItem.svelte';
	import { readStored, storageKey, writeStored } from './internal/storage.js';
	import { isEditable, isFrameMessage, PLAYER_KEYS } from './messages.js';
	import { describeFrame, useCommentsHolder, type CommentThreadPin } from './internal/comments.js';
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

	const holder = useCommentsHolder();
	const comments = $derived(holder?.current);
	const commenting = $derived(comments?.active ?? false);

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
	}

	// While the player is shown, a thread opened from the list or a link shows its frame.
	$effect(() => {
		const current = comments;
		if (!current) return;
		current.configure({
			show: (thread: CommentThreadPin) => {
				if (!prototype.get(thread.surface)) return false;
				show(thread.surface);
				return true;
			},
			describe: (id) => describeFrame(prototype, id)
		});
		return () => current.configure({ show: undefined });
	});

	function onkeydown(event: KeyboardEvent) {
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

<svelte:window {onkeydown} {onmessage} />

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
				{#if frame?.path}<span class="hidden truncate text-pf-island-muted md:inline">{frame.path}</span>{/if}
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
					onclick={() => comments.toggle()}
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
						<div role="group" aria-label={section.title}>
							<p class="px-2 pt-2 pb-1 text-xs text-pf-muted" aria-hidden="true">{section.title}</p>
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
						</div>
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
			{#if comments}<span data-vc-account></span>{/if}
		</div>
	</header>

	<div class="flex min-h-0 flex-1">
	<main
		class="flex min-h-0 flex-1 overflow-auto"
		bind:clientWidth={stageWidth}
		bind:clientHeight={stageHeight}
	>
		{#if frame}
			<div
				class="relative m-auto shrink-0"
				style:width="{frame.size.width * view.scale}px"
				style:height="{view.height * view.scale}px"
			>
			<div class={['absolute inset-0 overflow-hidden bg-white', scaleMode !== 'width' && 'rounded-md']}>
				{#each slots as slot, index (slot.key)}
					{@const shown = prototype.get(slot.id)}
					{#if shown}
						<!-- The frame on top takes comments; one still fading out does not. -->
						<iframe
							{@attach track(slot.key)}
							data-pf-player
							data-vc-surface={index === slots.length - 1 ? slot.id : undefined}
							data-vc-title={shown.title}
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
			</div>
		{:else}
			<p class="m-auto text-pf-canvas-muted">
				No frame “{frameId}”. <a class="underline" href={prototype.paths.canvas()}>Open the canvas</a>
			</p>
		{/if}
	</main>
	{#if commenting}
		<!-- Where the comments put their list, beside the stage. -->
		<div data-vc-panel class="my-3 mr-3 w-80 shrink-0"></div>
	{/if}
	</div>
</div>
