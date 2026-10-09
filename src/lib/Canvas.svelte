<!--
  Every frame laid out by section on a board you can pan and zoom, like a
  design tool's canvas. Frames here are previews: double-click one to open it
  in the player.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { devicePixelRatio } from 'svelte/reactivity/window';
	import { goto, replaceState } from '$app/navigation';
	import Icon from './internal/Icon.svelte';
	import AccountMenu from './internal/AccountMenu.svelte';
	import CanvasPreview from './internal/CanvasPreview.svelte';
	import CommentLayer, { type CommentDraft } from './internal/CommentLayer.svelte';
	import CommentsPanel from './internal/CommentsPanel.svelte';
	import { linkedThread } from './internal/comment-links.js';
	import { CommentAimer, type Pointer } from './internal/comment-aim.svelte.js';
	import { aimAt, frameDocument, MAGNET } from './internal/comment-target.js';
	import { createCanvasLoadQueue } from './internal/canvas-load-queue.js';
	import Menu from './internal/Menu.svelte';
	import MenuItem from './internal/MenuItem.svelte';
	import { readStored, storageKey, writeStored } from './internal/storage.js';
	import { isEditable } from './messages.js';
	import { useComments, type CommentThread } from './comments.js';
	import type { Flow, Frame, Prototype, Section } from './types.js';

	let {
		prototype,
		preview
	}: {
		prototype: Prototype;
		/** Screenshot URL; visible frames become live when zoom exceeds its pixel density. */
		preview?: (frame: Frame) => string;
	} = $props();

	// Canvas units are CSS pixels at 100% zoom.
	const FRAME_GAP = 160;
	const ROW_GAP = 320;
	const SECTION_PAD = 280;
	const SECTION_GAP = 400;
	const MIN_ZOOM = 0.02;
	const MAX_ZOOM = 4;
	const FIT_PADDING = 56;
	const LOAD_IDLE_MS = 50;
	// Below this on-screen width, frame titles are hidden.
	const MIN_LABEL_WIDTH = 72;
	// The comments panel floats over the right edge; fitting keeps frames clear of it.
	const PANEL_INSET = 320 + 12 * 2;
	const TOOLBAR_HEIGHT = 56;

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
	let pageScale = $state(1);
	const comments = useComments();
	const commenting = $derived(comments?.active ?? false);
	const rightInset = $derived(commenting ? PANEL_INSET : 0);
	let draft = $state<CommentDraft>();
	let commentLayer = $state<CommentLayer>();
	const pixelScale = $derived(camera.z * (devicePixelRatio.current ?? 1) * pageScale);
	const loadQueue = createCanvasLoadQueue();

	$effect(() => {
		// Camera changes cover wheel, keyboard, toolbar and pointer gestures. Also
		// wait for native pinch zoom and viewport/density changes to settle.
		camera.x; camera.y; camera.z; pixelScale; width; height;
		loadQueue.pause();
		if (!ready || panning) return;
		const timer = setTimeout(() => loadQueue.resume(), LOAD_IDLE_MS);
		return () => clearTimeout(timer);
	});

	onMount(() => {
		// Pinch zoom magnifies the visual viewport without changing devicePixelRatio.
		const visual = window.visualViewport;
		const update = () => { pageScale = visual?.scale ?? 1; };
		update();
		visual?.addEventListener('resize', update);
		return () => visual?.removeEventListener('resize', update);
	});

	function nearViewport(b: Box) {
		const margin = 96;
		const left = b.x * camera.z + camera.x;
		const top = b.y * camera.z + camera.y;
		return left < width + margin && left + b.w * camera.z > -margin
			&& top < height + margin && top + b.h * camera.z > -margin;
	}

	// Keep thumbnails (or dev iframes) once seen; production live frames are culled separately.
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

	function fitCamera(box: Box, padding = FIT_PADDING, maxZoom = MAX_ZOOM): Camera {
		const visible = width - rightInset;
		const z = clamp(
			Math.min((visible - padding * 2) / box.w, (height - padding * 2) / box.h),
			MIN_ZOOM,
			maxZoom
		);
		return { z, x: (visible - box.w * z) / 2 - box.x * z, y: (height - box.h * z) / 2 - box.y * z };
	}

	function fit(box: Box, padding = FIT_PADDING) {
		stopAnimation();
		camera = fitCamera(box, padding);
		persist();
	}

	let animation = 0;
	function stopAnimation() {
		cancelAnimationFrame(animation);
		animation = 0;
	}

	// Glides to a camera. The point at the centre of the view moves linearly and
	// the zoom changes geometrically, so zooming and panning feel even.
	function animateTo(target: Camera, duration = 480) {
		stopAnimation();
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
			camera = target;
			persist();
			return;
		}
		const from = { ...camera };
		const cx = width / 2;
		const cy = height / 2;
		const a = { x: (cx - from.x) / from.z, y: (cy - from.y) / from.z };
		const b = { x: (cx - target.x) / target.z, y: (cy - target.y) / target.z };
		const start = performance.now();
		const step = (time: number) => {
			const t = Math.min(1, (time - start) / duration);
			const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
			const z = from.z * (target.z / from.z) ** e;
			camera = { z, x: cx - (a.x + (b.x - a.x) * e) * z, y: cy - (a.y + (b.y - a.y) * e) * z };
			if (t < 1) animation = requestAnimationFrame(step);
			else {
				animation = 0;
				persist();
			}
		};
		animation = requestAnimationFrame(step);
	}

	function zoomAt(factor: number, sx = width / 2, sy = height / 2) {
		stopAnimation();
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
		// Keep the frame and its title below the floating toolbar while centering it.
		if (box) fit(box, 72);
	}

	const zoomActions = [
		{ label: 'Zoom in', hint: '+', run: () => zoomAt(1.25) },
		{ label: 'Zoom out', hint: '−', run: () => zoomAt(0.8) },
		{ label: 'Zoom to fit', hint: '⇧1', run: () => fit(layout.bounds) },
		{ label: 'Zoom to 100%', hint: '⇧0', run: () => zoomTo(1) },
		{ label: 'Focus selection', hint: 'F / ⇧2', run: fitSelection }
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

	// The canvas point under the pointer.
	function toCanvas(event: { clientX: number; clientY: number }) {
		const rect = viewport!.getBoundingClientRect();
		return {
			x: (event.clientX - rect.left - camera.x) / camera.z,
			y: (event.clientY - rect.top - camera.y) / camera.z
		};
	}

	function hit(event: { clientX: number; clientY: number }): Frame | undefined {
		if (!viewport) return undefined;
		const { x, y } = toCanvas(event);
		for (const [id, b] of layout.frames) {
			if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return prototype.get(id);
		}
		return undefined;
	}

	function setCommenting(on: boolean) {
		if (!comments) return;
		comments.active = on;
		if (!on) {
			draft = undefined;
			comments.openThread(undefined);
		}
	}

	/** A frame's document while it is live (not an image preview) and loaded. */
	function documentOf(id: string) {
		return frameDocument(viewport?.querySelector(`iframe[data-pf-frame="${CSS.escape(id)}"]`), id);
	}

	// Where a click would pin, pulled onto the element near the pointer once the
	// frame is live. Alt pins anywhere.
	function aimFor(pointer: Pointer) {
		const frame = hit(pointer);
		const box = frame && layout.frames.get(frame.id);
		if (!frame || !box) return undefined;
		const { x, y } = toCanvas(pointer);
		return aimAt(frame.id, x - box.x, y - box.y, pointer.altKey ? undefined : documentOf(frame.id), MAGNET / camera.z);
	}

	const aimer = new CommentAimer((pointer) =>
		commenting && !panning && !draft && comments?.openId === undefined ? aimFor(pointer) : undefined
	);

	$effect(() => {
		void [camera.x, camera.y, camera.z, commenting, panning, draft, comments?.openId];
		aimer.update();
	});

	// In comment mode a click starts a thread on the frame under it. A click away
	// from an open thread closes it first, as does Escape.
	function placeComment(event: MouseEvent) {
		if (!comments) return;
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

	// Pans and zooms to a thread's frame unless its pin is already in view, then opens it.
	function focusThread(thread: CommentThread) {
		if (!comments) return;
		draft = undefined;
		comments.active = true;
		comments.openThread(thread.id);
		const box = layout.frames.get(thread.frame);
		if (!box) return;
		const target = fitCamera(box, 72, Math.max(camera.z, 1));
		const pin = placePin(thread.frame, thread.x, thread.y);
		const inView = pin && pin.left > 40 && pin.left < width - rightInset - 360
			&& pin.top > TOOLBAR_HEIGHT + 40 && pin.top < height - 40;
		if (!inView || camera.z < target.z * 0.5) animateTo(target);
	}

	function placePin(frame: string, x: number, y: number) {
		const b = layout.frames.get(frame);
		if (!b) return undefined;
		return { left: (b.x + x) * camera.z + camera.x, top: (b.y + y) * camera.z + camera.y };
	}

	// Open a shared link to a thread once comments have loaded.
	let linked = $state<number>();
	$effect(() => {
		if (!comments || linked === undefined || comments.loading || !ready) return;
		const thread = comments.threads.find((t) => t.id === linked);
		linked = undefined;
		replaceState(`${location.pathname}${location.search}`, {});
		if (thread) {
			comments.filters.showResolved ||= Boolean(thread.resolvedAt);
			focusThread(thread);
		}
	});

	let drag: { sx: number; sy: number; x: number; y: number; moved: boolean } | undefined;

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0 && event.button !== 1) return;
		if ((event.target as Element).closest('[data-pf-ui]')) return;
		stopAnimation();
		viewport?.setPointerCapture(event.pointerId);
		drag = { sx: event.clientX, sy: event.clientY, x: camera.x, y: camera.y, moved: false };
	}

	function onpointermove(event: PointerEvent) {
		if (!drag) {
			hovered = commenting ? undefined : hit(event)?.id;
			aimer.move((event.target as Element).closest('[data-pf-ui]') ? undefined : event);
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
		else if (event.button === 0 && commenting) placeComment(event);
		else if (event.button === 0) {
			// Outside comment mode a click away from an open thread just closes it.
			if (comments?.openId !== undefined) comments.openThread(undefined);
			select(hit(event)?.id);
		}
		drag = undefined;
		panning = false;
		// The pointer moved while the view was panning; draw the comment cursor where it is now.
		aimer.move((event.target as Element).closest('[data-pf-ui]') ? undefined : event);
	}

	function ondblclick(event: MouseEvent) {
		if ((event.target as Element).closest('[data-pf-ui]')) return;
		const frame = hit(event);
		if (frame) play(frame.id);
	}

	// Wheel listeners must be non-passive to stop the browser zooming the page.
	function wheel(node: HTMLElement) {
		const onwheel = (event: WheelEvent) => {
			// Let an open thread scroll its replies.
			const scroller = (event.target as Element).closest('[data-pf-scroll]');
			if (scroller && !event.ctrlKey && !event.metaKey && scroller.scrollHeight > scroller.clientHeight) return;
			event.preventDefault();
			stopAnimation();
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
		aimer.key(event);
		if (isEditable(event.target) || document.querySelector(':popover-open')) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const actions: Record<string, () => void> = {
			'shift+Digit1': () => fit(layout.bounds),
			'shift+Digit0': () => zoomTo(1),
			'shift+Digit2': fitSelection,
			KeyF: fitSelection,
			Equal: () => zoomAt(1.25),
			NumpadAdd: () => zoomAt(1.25),
			Minus: () => zoomAt(0.8),
			NumpadSubtract: () => zoomAt(0.8),
			Enter: () => selected && play(selected),
			KeyC: () => setCommenting(!commenting),
			Escape: () => {
				if (draft) draft = undefined;
				else if (comments?.openId !== undefined) comments.openThread(undefined);
				else if (commenting) setCommenting(false);
				else select(undefined);
			},
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
		linked = linkedThread(location.hash);
		ready = true;
		return () => {
			clearTimeout(persistTimer);
			stopAnimation();
			loadQueue.destroy();
		};
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

<svelte:window {onkeydown} onkeyup={(event) => aimer.key(event)} />

<div class="pf-root relative flex h-dvh flex-col bg-pf-canvas font-pf text-[13px] text-pf-canvas-ink">
	<header class="pf-toolbar absolute inset-x-3 top-3 z-20">
		<div class="pf-island min-h-10 gap-2.5 py-1.5 pr-5 pl-3.5">
			<span class="shrink-0"><Icon name="canvas" size={18} /></span>
			<div class="min-w-0">
				<h1 class="truncate text-sm font-semibold leading-5">{prototype.title}</h1>
				{#if prototype.description}
					<p class="truncate text-xs text-pf-island-muted">{prototype.description}</p>
				{/if}
			</div>
		</div>

		<nav class="pf-island ml-auto shrink-0" aria-label="Canvas controls">
			{#if prototype.flows.length}
				<Menu label="Play a flow" align="end" class="pf-tool gap-1.5 px-3">
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

			<Menu label="Zoom" align="end" class="pf-tool w-20 justify-between gap-1.5 px-3">
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

			<button
				type="button"
				class="pf-tool pf-tool-primary"
				onclick={() => play(selected)}
				title={selectedFrame ? `Play from “${selectedFrame.title}”` : 'Play from the first frame'}
			>
				<Icon name="play" size={14} />
				Play
			</button>
			<AccountMenu />
		</nav>
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
		onpointerleave={() => {
			hovered = undefined;
			aimer.move(undefined);
		}}
		{ondblclick}
		role="application"
		aria-label="Canvas of all frames"
		class={[
			'relative min-h-0 flex-1 touch-none overflow-hidden select-none',
			panning ? 'cursor-grabbing' : commenting && (aimer.cursor ? 'cursor-none' : 'pf-comment-cursor')
		]}
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
					class="absolute rounded-[16px] bg-pf-section"
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
						class="absolute overflow-hidden bg-white"
						style:left="{b.x}px"
						style:top="{b.y}px"
						style:width="{b.w}px"
						style:height="{b.h}px"
					>
						{#if seen.has(frame.id)}
							{#if preview}
								<CanvasPreview
									{frame}
									src={prototype.paths.frame(frame.id)}
									preview={preview(frame)}
									{pixelScale}
									nearViewport={nearViewport(b)}
									scheduleLoad={loadQueue.request}
								/>
							{:else}
								<iframe
									data-pf-canvas
									data-pf-frame={frame.id}
									src={prototype.paths.frame(frame.id)}
									title={frame.title}
									tabindex="-1"
									class="pointer-events-none size-full border-0"
								></iframe>
							{/if}
						{/if}
					</div>
				{/if}
			{/each}
		</div>

		{#if ready}
			{#each layout.sections as { section, box } (section.id)}
				{@const s = screen(box)}
				<p
					class="pointer-events-none absolute truncate text-sm font-semibold text-pf-canvas-ink"
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
									frame.id === selected ? 'text-pf-selection' : 'text-pf-canvas-muted hover:text-pf-canvas-ink'
								]}
								onclick={() => select(frame.id)}
								ondblclick={() => play(frame.id)}
							>
								{frame.title}
							</button>
							{#if frame.id === selected || frame.id === hovered}
								<button
									type="button"
									class="shrink-0 rounded p-0.5 text-pf-selection hover:bg-pf-selection/10"
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
									class="inline-flex h-5 max-w-full items-center gap-1 rounded-[2px] bg-pf-accent pr-2 pl-1.5 text-[11px] font-medium text-pf-surface shadow-sm hover:brightness-110"
									onclick={() => startFlow(flow)}
									title="Play the flow “{flow.title}”"
								>
									<Icon name="play" size={10} />
									<span class="truncate">{flow.title}</span>
								</button>
							{/each}
						</div>
					{/if}
					{#if (frame.id === selected && !commenting) || (frame.id === hovered && !panning)}
						<div
							class={[
								'pointer-events-none absolute',
								frame.id === selected ? 'ring-2 ring-pf-selection' : 'ring-1 ring-pf-selection/60'
							]}
							style:left="{s.left}px"
							style:top="{s.top}px"
							style:width="{s.width}px"
							style:height="{s.height}px"
						></div>
					{/if}
				{/if}
			{/each}

			{#if comments}
				<CommentLayer
					bind:this={commentLayer}
					bind:draft
					{prototype}
					aim={aimer.aim}
					cursor={commenting && !panning ? aimer.cursor : undefined}
					{documentOf}
					place={placePin}
					bounds={{ left: 0, top: TOOLBAR_HEIGHT, right: width - rightInset, bottom: height }}
				/>
			{/if}
		{/if}
	</div>

	{#if comments && commenting}
		<CommentsPanel
			{prototype}
			class="absolute top-[60px] right-3 bottom-3 z-20 w-80"
			onselect={focusThread}
			onclose={() => setCommenting(false)}
		/>
	{/if}
</div>
