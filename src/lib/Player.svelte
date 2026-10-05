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
		show(flow?.start ?? frame?.section.frames[0]?.id);
	}

	function handleKey(key: string) {
		if (key === 'ArrowRight') show(prototype.next(frameId)?.id);
		else if (key === 'ArrowLeft') show(prototype.prev(frameId)?.id);
		else if (key === 'r' || key === 'R') restart();
	}

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
			else handleKey(message.key);
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

<div class="pf-root flex h-dvh flex-col bg-pf-stage font-pf text-[13px] text-white/90">
	<header
		class="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-white/10 bg-pf-ink px-2"
	>
		<div class="flex min-w-0 items-center gap-1">
			<a
				href={prototype.paths.canvas()}
				class="pf-tool"
				title="All frames (canvas)"
				aria-label="All frames (canvas)"
			>
				<Icon name="canvas" />
			</a>
			<div class="flex min-w-0 items-baseline gap-2 pl-1">
				<span class="truncate font-medium text-white">{frame?.title ?? frameId}</span>
				{#if frame}
					<span class="truncate text-white/50">{frame.section.title}</span>
				{/if}
			</div>
		</div>

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
			<span class="min-w-16 text-center text-white/60 tabular-nums">
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

		<div class="flex items-center justify-end gap-1">
			{#if prototype.flows.length}
				<Menu label="Flows" tone="dark" align="end" class="pf-tool gap-1.5 px-2.5">
					{#snippet trigger()}
						<span class="max-w-48 truncate">{flow?.title ?? 'Flows'}</span>
						<Icon name="chevron-down" size={14} />
					{/snippet}
					{#snippet children(close)}
						{#each prototype.flows as item (item.id)}
							<MenuItem
								tone="dark"
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

			<button
				type="button"
				class="pf-tool"
				onclick={restart}
				title={flow ? `Restart “${flow.title}” (R)` : 'Back to the first frame in this section (R)'}
				aria-label="Restart"
			>
				<Icon name="restart" />
			</button>

			<Menu label="Jump to a frame" tone="dark" align="end" class="pf-tool gap-1.5 px-2.5">
				{#snippet trigger()}
					<span>Frames</span>
					<Icon name="chevron-down" size={14} />
				{/snippet}
				{#snippet children(close)}
					{#each prototype.sections as section (section.id)}
						<p class="px-2 pt-2 pb-1 text-xs text-white/45">{section.title}</p>
						{#each section.frames as item (item.id)}
							<MenuItem
								tone="dark"
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

			<Menu label="Scale" tone="dark" align="end" class="pf-tool gap-1.5 px-2.5">
				{#snippet trigger()}
					<span class="tabular-nums">{Math.round(view.scale * 100)}%</span>
					<Icon name="chevron-down" size={14} />
				{/snippet}
				{#snippet children(close)}
					{#each SCALES as option (option.value)}
						<MenuItem
							tone="dark"
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
		</div>
	</header>

	<main
		class="flex min-h-0 flex-1 overflow-auto"
		bind:clientWidth={stageWidth}
		bind:clientHeight={stageHeight}
	>
		{#if frame}
			<div
				class="relative m-auto shrink-0 overflow-hidden bg-white shadow-[0_8px_40px_rgb(0_0_0/0.35)]"
				class:rounded-md={scaleMode !== 'width'}
				style:width="{frame.size.width * view.scale}px"
				style:height="{view.height * view.scale}px"
			>
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
		{:else}
			<p class="m-auto text-white/60">
				No frame “{frameId}”. <a class="underline" href={prototype.paths.canvas()}>Open the canvas</a>
			</p>
		{/if}
	</main>
</div>
