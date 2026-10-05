<script lang="ts">
	import { untrack } from 'svelte';
	import { isFrameMessage } from '../messages.js';
	import type { Frame } from '../types.js';

	let {
		frame,
		src,
		preview,
		pixelScale,
		nearViewport
	}: {
		frame: Frame;
		src: string;
		preview: string;
		/** Device pixels per canvas CSS pixel, including canvas and browser zoom. */
		pixelScale: number;
		nearViewport: boolean;
	} = $props();

	const FADE_MS = 160;
	const RETURN_TO_IMAGE = 0.85;
	let imageWidth = $state(0);
	let imageHeight = $state(0);
	let imageFailed = $state(false);
	let live = $state(false);
	let mounted = $state(false);
	let ready = $state(false);

	// Direct image URLs have no srcset density correction: natural dimensions are
	// the screenshot's available pixels. Use the weaker axis if sizes differ.
	const sampling = $derived(imageFailed ? Infinity : imageWidth && imageHeight
		? pixelScale * Math.max(frame.size.width / imageWidth, frame.size.height / imageHeight)
		: 0);

	$effect(() => {
		const nearby = nearViewport;
		const ratio = sampling;
		untrack(() => {
			if (!nearby || ratio <= RETURN_TO_IMAGE) live = false;
			else if (ratio >= 1) live = true;
		});
	});

	$effect(() => {
		if (live) {
			mounted = true;
			return;
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
				paint = requestAnimationFrame(() => { ready = true; });
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
		data-pf-canvas
		data-pf-ready={ready}
		{src}
		title={frame.title}
		tabindex="-1"
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 size-full border-0"
		style:opacity={live && ready ? 1 : 0}
		style:transition="opacity {FADE_MS}ms ease"
	></iframe>
{/if}

<style>
	@media (prefers-reduced-motion: reduce) {
		iframe { transition: none !important; }
	}
</style>
