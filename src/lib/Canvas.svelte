<!--
  Every frame laid out by section on a board you can pan and zoom, like a
  design tool's canvas. Frames here are previews: double-click one to open it
  in the player.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import Icon from './internal/Icon.svelte';
	import Menu from './internal/Menu.svelte';
	import MenuItem from './internal/MenuItem.svelte';
	import { readStored, storageKey, writeStored } from './internal/storage.js';
	import { isEditable } from './messages.js';
	import type { Flow, Frame, Prototype, Section } from './types.js';

	let { prototype }: { prototype: Prototype } = $props();

	// Canvas units are CSS pixels at 100% zoom.
	const FRAME_GAP = 160;
	const ROW_GAP = 320;
	const SECTION_PAD = 280;
	const SECTION_GAP = 400;
	const MIN_ZOOM = 0.02;
	const MAX_ZOOM = 4;
	const FIT_PADDING = 56;
	// Below this on-screen width, frame titles are hidden.
	const MIN_LABEL_WIDTH = 72;

	type Box = { x: number; y: number; w: number; h: number };
	type Camera = { x: number; y: number; z: number };

	const layout = $derived.by(() => {
		const frames = new Map<string, Box>();
		const sections: { section: Section; box: Box }[] = [];
		let top = 0;
		let width = 0;
		for (const section of prototype.sections) {
			const columns = Math.max(1, section.columns ?? section.frames.length);
			let x = SECTION_PAD;
			let y = top + SECTION_PAD;
			let rowHeight = 0;
			let right = SECTION_PAD;
			section.frames.forEach((frame, i) => {
				if (i > 0 && i % columns === 0) {
					x = SECTION_PAD;
					y += rowHeight + ROW_GAP;
					rowHeight = 0;
				}
				frames.set(frame.id, { x, y, w: frame.size.width, h: frame.size.height });
				right = Math.max(right, x + frame.size.width);
				x += frame.size.width + FRAME_GAP;
				rowHeight = Math.max(rowHeight, frame.size.height);
			});
			const box = { x: 0, y: top, w: right + SECTION_PAD, h: y + rowHeight + SECTION_PAD - top };
			sections.push({ section, box });
			width = Math.max(width, box.w);
			top += box.h + SECTION_GAP;
		}
		const bounds: Box = { x: 0, y: 0, w: Math.max(width, 1), h: Math.max(top - SECTION_GAP, 1) };
		return { frames, sections, bounds };
	});

	const keys = $derived({
		camera: storageKey(prototype.title, 'camera'),
		selected: storageKey(prototype.title, 'selected'),
		last: storageKey(prototype.title, 'last'),
		flow: storageKey(prototype.title, 'flow')
	});

	let viewport = $state<HTMLDivElement>();
	let width = $state(0);
	let height = $state(0);
	let camera = $state<Camera>({ x: 0, y: 0, z: 0.1 });
	let ready = $state(false);
	let selected = $state<string | undefined>();
	let hovered = $state<string | undefined>();
	let panning = $state(false);

	// Frames load once they first come near the viewport, then stay loaded.
	const seen = new SvelteSet<string>();

	$effect(() => {
		if (!ready) return;
		const { x, y, z } = camera;
		const margin = 0.25;
		const left = (-x - width * margin) / z;
		const right = (width * (1 + margin) - x) / z;
		const top = (-y - height * margin) / z;
		const bottom = (height * (1 + margin) - y) / z;
		for (const [id, b] of layout.frames) {
			if (seen.has(id)) continue;
			if (b.x < right && b.x + b.w > left && b.y < bottom && b.y + b.h > top) seen.add(id);
		}
	});

	const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

	function fit(box: Box, padding = FIT_PADDING) {
		const z = clamp(
			Math.min((width - padding * 2) / box.w, (height - padding * 2) / box.h),
			MIN_ZOOM,
			MAX_ZOOM
		);
		camera = { z, x: (width - box.w * z) / 2 - box.x * z, y: (height - box.h * z) / 2 - box.y * z };
		persist();
	}

	function zoomAt(factor: number, sx = width / 2, sy = height / 2) {
		const z = clamp(camera.z * factor, MIN_ZOOM, MAX_ZOOM);
		const cx = (sx - camera.x) / camera.z;
		const cy = (sy - camera.y) / camera.z;
		camera = { z, x: sx - cx * z, y: sy - cy * z };
		persist();
	}

	function zoomTo(z: number) {
		zoomAt(z / camera.z);
	}

	function fitSelection() {
		const box = selected && layout.frames.get(selected);
		if (box) fit(box, 40);
	}

	const zoomActions = [
		{ label: 'Zoom in', hint: '+', run: () => zoomAt(1.25) },
		{ label: 'Zoom out', hint: '−', run: () => zoomAt(0.8) },
		{ label: 'Zoom to fit', hint: '⇧1', run: () => fit(layout.bounds) },
		{ label: 'Zoom to 100%', hint: '⇧0', run: () => zoomTo(1) },
		{ label: 'Zoom to selection', hint: '⇧2', run: () => fitSelection() }
	];

	let persistTimer: ReturnType<typeof setTimeout> | undefined;
	function persist() {
		clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			writeStored('session', keys.camera, camera);
			writeStored('session', keys.selected, selected ?? null);
		}, 150);
	}

	function select(id: string | undefined) {
		selected = id;
		persist();
	}

	function play(id: string | undefined, flow?: Flow) {
		const frame = (id && prototype.get(id)) || prototype.frames[0];
		if (!frame) return;
		// The player shows the active flow; playing a single frame leaves any flow.
		writeStored('session', keys.flow, flow?.id ?? null);
		goto(prototype.paths.play(frame.id));
	}

	const startFlow = (flow: Flow) => play(flow.start, flow);

	// Flows that start on each frame, to mark starting points on the canvas.
	const flowsByStart = $derived.by(() => {
		const map = new Map<string, Flow[]>();
		for (const flow of prototype.flows) map.set(flow.start, [...(map.get(flow.start) ?? []), flow]);
		return map;
	});

	function hit(event: MouseEvent): Frame | undefined {
		if (!viewport) return undefined;
		const rect = viewport.getBoundingClientRect();
		const cx = (event.clientX - rect.left - camera.x) / camera.z;
		const cy = (event.clientY - rect.top - camera.y) / camera.z;
		for (const [id, b] of layout.frames) {
			if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) return prototype.get(id);
		}
		return undefined;
	}

	let drag: { sx: number; sy: number; x: number; y: number; moved: boolean } | undefined;

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0 && event.button !== 1) return;
		if ((event.target as Element).closest('[data-pf-ui]')) return;
		viewport?.setPointerCapture(event.pointerId);
		drag = { sx: event.clientX, sy: event.clientY, x: camera.x, y: camera.y, moved: false };
	}

	function onpointermove(event: PointerEvent) {
		if (!drag) {
			hovered = hit(event)?.id;
			return;
		}
		const dx = event.clientX - drag.sx;
		const dy = event.clientY - drag.sy;
		if (!drag.moved && Math.hypot(dx, dy) < 4) return;
		drag.moved = true;
		panning = true;
		camera.x = drag.x + dx;
		camera.y = drag.y + dy;
	}

	function onpointerup(event: PointerEvent) {
		if (!drag) return;
		if (drag.moved) persist();
		else if (event.button === 0) select(hit(event)?.id);
		drag = undefined;
		panning = false;
	}

	function ondblclick(event: MouseEvent) {
		if ((event.target as Element).closest('[data-pf-ui]')) return;
		const frame = hit(event);
		if (frame) play(frame.id);
	}

	// Wheel listeners must be non-passive to stop the browser zooming the page.
	function wheel(node: HTMLElement) {
		const onwheel = (event: WheelEvent) => {
			event.preventDefault();
			const unit = event.deltaMode === 1 ? 16 : 1;
			if (event.ctrlKey || event.metaKey) {
				const rect = node.getBoundingClientRect();
				const delta = clamp(event.deltaY * unit, -50, 50);
				zoomAt(Math.exp(-delta * 0.01), event.clientX - rect.left, event.clientY - rect.top);
			} else {
				const horizontal = event.shiftKey && !event.deltaX;
				camera.x -= (horizontal ? event.deltaY : event.deltaX) * unit;
				camera.y -= (horizontal ? 0 : event.deltaY) * unit;
				persist();
			}
		};
		node.addEventListener('wheel', onwheel, { passive: false });
		return () => node.removeEventListener('wheel', onwheel);
	}

	function step(offset: number) {
		const index = selected ? (prototype.get(selected)?.index ?? -1) : -1;
		const next = prototype.frames[clamp(index + offset, 0, prototype.frames.length - 1)];
		if (!next) return;
		select(next.id);
		fitSelection();
	}

	function onkeydown(event: KeyboardEvent) {
		if (isEditable(event.target) || document.querySelector(':popover-open')) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const actions: Record<string, () => void> = {
			'shift+Digit1': () => fit(layout.bounds),
			'shift+Digit0': () => zoomTo(1),
			'shift+Digit2': fitSelection,
			Equal: () => zoomAt(1.25),
			NumpadAdd: () => zoomAt(1.25),
			Minus: () => zoomAt(0.8),
			NumpadSubtract: () => zoomAt(0.8),
			Enter: () => selected && play(selected),
			Escape: () => select(undefined),
			ArrowRight: () => step(1),
			ArrowLeft: () => step(-1)
		};
		const action = actions[event.shiftKey ? `shift+${event.code}` : event.code];
		if (action) {
			event.preventDefault();
			action();
		}
	}

	onMount(() => {
		if (!viewport) return;
		width = viewport.clientWidth;
		height = viewport.clientHeight;
		const stored = readStored<Camera | null>('session', keys.camera, null);
		selected =
			readStored<string | null>('session', keys.last, null) ??
			readStored<string | null>('session', keys.selected, null) ??
			undefined;
		if (selected && !prototype.get(selected)) selected = undefined;
		if (stored) camera = stored;
		else fit(layout.bounds);
		ready = true;
		return () => clearTimeout(persistTimer);
	});

	// Screen position of a canvas box.
	const screen = (b: Box) => ({
		left: b.x * camera.z + camera.x,
		top: b.y * camera.z + camera.y,
		width: b.w * camera.z,
		height: b.h * camera.z
	});

	// A dot grid that pans and zooms with the canvas, kept between 16 and 64 px apart.
	const grid = $derived.by(() => {
		let size = 40 * camera.z;
		while (size < 16) size *= 2;
		while (size > 64) size /= 2;
		return { size, x: camera.x % size, y: camera.y % size };
	});

	const selectedFrame = $derived(selected ? prototype.get(selected) : undefined);
</script>

<svelte:window {onkeydown} />

<div class="pf-root flex h-dvh flex-col bg-pf-canvas font-pf text-[13px] text-pf-ink">
	<header class="flex h-12 shrink-0 items-center gap-3 border-b border-pf-line bg-white px-4">
		<div class="flex min-w-0 flex-1 items-baseline gap-3">
			<h1 class="truncate text-sm font-semibold">{prototype.title}</h1>
			{#if prototype.description}
				<p class="truncate text-pf-muted">{prototype.description}</p>
			{/if}
		</div>

		{#if prototype.flows.length}
			<Menu label="Play a flow" align="end" class="pf-tool-light gap-1.5 px-2.5">
				{#snippet trigger()}
					<span>Flows</span>
					<Icon name="chevron-down" size={14} />
				{/snippet}
				{#snippet children(close)}
					{#each prototype.flows as flow (flow.id)}
						<MenuItem
							onselect={() => {
								close();
								startFlow(flow);
							}}
							hint={prototype.get(flow.start)?.title}
						>
							{flow.title}
						</MenuItem>
					{/each}
				{/snippet}
			</Menu>
		{/if}

		<Menu label="Zoom" align="end" class="pf-tool-light w-20 justify-between gap-1.5 px-2.5">
			{#snippet trigger()}
				<span class="tabular-nums">{Math.round(camera.z * 100)}%</span>
				<Icon name="chevron-down" size={14} />
			{/snippet}
			{#snippet children(close)}
				{#each zoomActions as entry (entry.label)}
					<MenuItem
						hint={entry.hint}
						onselect={() => {
							close();
							entry.run();
						}}
					>
						{entry.label}
					</MenuItem>
				{/each}
				<p class="max-w-60 border-t border-pf-line px-2 pt-2 pb-1 text-xs leading-relaxed text-pf-muted">
					Scroll or drag to pan. Hold ⌘ or Ctrl and scroll to zoom. Double-click a frame to play it.
				</p>
			{/snippet}
		</Menu>

		<button
			type="button"
			class="inline-flex h-8 items-center gap-1.5 rounded-md bg-pf-accent px-3 font-medium text-white hover:brightness-110"
			onclick={() => play(selected)}
			title={selectedFrame ? `Play from “${selectedFrame.title}”` : 'Play from the first frame'}
		>
			<Icon name="play" size={14} />
			Play
		</button>
	</header>

	<div
		bind:this={viewport}
		bind:clientWidth={width}
		bind:clientHeight={height}
		{@attach wheel}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={onpointerup}
		onpointerleave={() => (hovered = undefined)}
		{ondblclick}
		role="application"
		aria-label="Canvas of all frames"
		class={['relative min-h-0 flex-1 touch-none overflow-hidden select-none', panning && 'cursor-grabbing']}
		style:background-image="radial-gradient(circle, var(--pf-grid) 1px, transparent 1.4px)"
		style:background-size="{grid.size}px {grid.size}px"
		style:background-position="{grid.x}px {grid.y}px"
	>
		<div
			class="absolute top-0 left-0 origin-top-left transition-opacity"
			style:transform="translate({camera.x}px, {camera.y}px) scale({camera.z})"
			style:opacity={ready ? 1 : 0}
		>
			{#each layout.sections as { section, box } (section.id)}
				<div
					class="absolute rounded-[48px] bg-pf-section"
					style:left="{box.x}px"
					style:top="{box.y}px"
					style:width="{box.w}px"
					style:height="{box.h}px"
				></div>
			{/each}
			{#each prototype.frames as frame (frame.id)}
				{@const b = layout.frames.get(frame.id)}
				{#if b}
					<div
						class="absolute overflow-hidden bg-white shadow-[0_2px_24px_rgb(15_23_42/0.12)]"
						style:left="{b.x}px"
						style:top="{b.y}px"
						style:width="{b.w}px"
						style:height="{b.h}px"
					>
						{#if seen.has(frame.id)}
							<iframe
								data-pf-canvas
								src={prototype.paths.frame(frame.id)}
								title={frame.title}
								tabindex="-1"
								class="pointer-events-none size-full border-0"
							></iframe>
						{/if}
					</div>
				{/if}
			{/each}
		</div>

		{#if ready}
			{#each layout.sections as { section, box } (section.id)}
				{@const s = screen(box)}
				<p
					class="pointer-events-none absolute truncate text-sm font-semibold text-pf-ink/80"
					style:left="{s.left + 4}px"
					style:top="{s.top - 26}px"
					style:max-width="{Math.max(s.width, 160)}px"
				>
					{section.title}
				</p>
			{/each}

			{#each prototype.frames as frame (frame.id)}
				{@const b = layout.frames.get(frame.id)}
				{#if b}
					{@const s = screen(b)}
					{#if s.width >= MIN_LABEL_WIDTH}
						<div
							data-pf-ui
							class="absolute flex items-center gap-1"
							style:left="{s.left}px"
							style:top="{s.top - 21}px"
							style:max-width="{s.width + FRAME_GAP * camera.z - 8}px"
						>
							<button
								type="button"
								class={[
									'min-w-0 truncate rounded px-1 text-xs',
									frame.id === selected ? 'text-pf-accent' : 'text-pf-muted hover:text-pf-ink'
								]}
								onclick={() => select(frame.id)}
								ondblclick={() => play(frame.id)}
							>
								{frame.title}
							</button>
							{#if frame.id === selected || frame.id === hovered}
								<button
									type="button"
									class="shrink-0 rounded p-0.5 text-pf-accent hover:bg-pf-accent/10"
									onclick={() => play(frame.id)}
									aria-label="Play “{frame.title}”"
									title="Play"
								>
									<Icon name="play" size={12} />
								</button>
							{/if}
						</div>
					{/if}
					{#if flowsByStart.has(frame.id) && s.width >= MIN_LABEL_WIDTH}
						<!-- Flow starting points, pinned to the frame's top-left corner. -->
						<div
							data-pf-ui
							class="absolute z-10 flex flex-col items-start gap-1"
							style:left="{s.left + 6}px"
							style:top="{s.top + 6}px"
							style:max-width="{s.width - 12}px"
						>
							{#each flowsByStart.get(frame.id) ?? [] as flow (flow.id)}
								<button
									type="button"
									class="inline-flex h-5 max-w-full items-center gap-1 rounded-full bg-pf-accent pr-2 pl-1.5 text-[11px] font-medium text-white shadow-sm hover:brightness-110"
									onclick={() => startFlow(flow)}
									title="Play the flow “{flow.title}”"
								>
									<Icon name="play" size={10} />
									<span class="truncate">{flow.title}</span>
								</button>
							{/each}
						</div>
					{/if}
					{#if frame.id === selected || (frame.id === hovered && !panning)}
						<div
							class={[
								'pointer-events-none absolute',
								frame.id === selected ? 'ring-2 ring-pf-accent' : 'ring-1 ring-pf-accent/60'
							]}
							style:left="{s.left}px"
							style:top="{s.top}px"
							style:width="{s.width}px"
							style:height="{s.height}px"
						></div>
					{/if}
				{/if}
			{/each}
		{/if}
	</div>
</div>
