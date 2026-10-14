<script lang="ts">
	import { untrack } from 'svelte';
	import { isFrameMessage } from '../messages.js';
	import type { Frame } from '../types.js';
	import type { ScheduleFrameLoad } from './canvas-load-queue.js';
	import { canvasFrame } from './canvas-frame.js';

	let {
		frame,
		src,
		preview,
		pixelScale,
		nearViewport,
		hovered,
		scheduleLoad
	}: {
		frame: Frame;
		src: string;
		preview: string;
		/** Device pixels per canvas CSS pixel, including canvas and browser zoom. */
		pixelScale: number;
		nearViewport: boolean;
		hovered: boolean;
		scheduleLoad: ScheduleFrameLoad;
	} = $props();

	const FADE_MS = 160;
	const RETURN_TO_IMAGE = 0.85;
	let imageWidth = $state(0);
	let imageHeight = $state(0);
	let imageFailed = $state(false);
	let live = $state(false);
	let mounted = $state(false);
	let ready = $state(false);
	let completeLoad = () => {};

	// Direct image URLs have no srcset density correction: natural dimensions are
	// the screenshot's available pixels. Use the weaker axis if sizes differ.
	const sampling = $derived(imageFailed ? Infinity : imageWidth && imageHeight
		? pixelScale * Math.max(frame.size.width / imageWidth, frame.size.height / imageHeight)
		: 0);

	$effect(() => {
		const nearby = nearViewport;
		const ratio = sampling;
		const hovering = hovered;
		untrack(() => {
			if (!nearby) live = false;
			else if (hovering || ratio >= 1) live = true;
			else if (ratio <= RETURN_TO_IMAGE) live = false;
		});
	});

	$effect(() => {
		if (live) {
			if (untrack(() => mounted)) return;
			// The canvas starts this job only while idle. Effect cleanup cancels it
			// when this frame leaves the viewport or returns to thumbnail scale.
			return scheduleLoad((complete) => {
				completeLoad = complete;
				mounted = true;
			});
		}
		// Keep the image underneath throughout both fades. Off-screen frames and
		// frames that never finished loading can be destroyed immediately.
		if (!nearViewport || !untrack(() => ready)) {
			mounted = false;
			return;
		}
		const timer = setTimeout(() => { mounted = false; }, FADE_MS);
		return () => clearTimeout(timer);
	});

	function trackFrame(node: HTMLIFrameElement) {
		ready = false;
		let loaded = false;
		let hydrated = false;
		let paint = 0;
		function reveal() {
			if (!loaded || !hydrated) return;
			cancelAnimationFrame(paint);
			// Allow ResizeObserver-driven charts to lay out after fonts and hydration.
			paint = requestAnimationFrame(() => {
				paint = requestAnimationFrame(() => {
					ready = true;
					completeLoad();
				});
			});
		}
		function onload() {
			loaded = true;
			reveal();
		}
		function onmessage(event: MessageEvent) {
			if (event.origin !== location.origin || event.source !== node.contentWindow) return;
			if (!isFrameMessage(event.data) || event.data.type !== 'paraframe:ready') return;
			if (event.data.frame !== frame.id) return;
			hydrated = true;
			reveal();
		}
		node.addEventListener('load', onload);
		window.addEventListener('message', onmessage);
		return () => {
			cancelAnimationFrame(paint);
			completeLoad();
			node.removeEventListener('load', onload);
			window.removeEventListener('message', onmessage);
			ready = false;
		};
	}
</script>

<img
	data-pf-canvas
	src={preview}
	alt={frame.title}
	width={frame.size.width}
	height={frame.size.height}
	decoding="async"
	draggable="false"
	onload={(event) => {
		const image = event.currentTarget as HTMLImageElement;
		imageWidth = image.naturalWidth;
		imageHeight = image.naturalHeight;
		imageFailed = false;
	}}
	onerror={() => { imageFailed = true; }}
	class="pointer-events-none size-full"
/>
{#if mounted}
	<iframe
		{@attach trackFrame}
		{@attach canvasFrame}
		data-pf-canvas
		data-pf-frame={frame.id}
		data-pf-ready={ready}
		{src}
		title={frame.title}
		tabindex="-1"
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 size-full border-0 data-[pf-hover=true]:pointer-events-auto"
		style:pointer-events={live && ready ? undefined : 'none'}
		style:opacity={live && ready ? 1 : 0}
		style:transition="opacity {FADE_MS}ms ease"
	></iframe>
{/if}

<style>
	@media (prefers-reduced-motion: reduce) {
		iframe { transition: none !important; }
	}
</style>
