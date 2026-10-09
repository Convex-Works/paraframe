<!--
  Renders one frame on its own page. The player and canvas load this page in
  iframes; it can also be opened directly. Links inside the frame tell the
  player to navigate, or navigate this page when opened directly.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { isEditable, PLAYER_KEYS, postToHost } from './messages.js';
	import { setFrameNav, type FrameNav } from './nav.js';
	import type { Prototype, ResolvedFrame } from './types.js';

	let { prototype, resolved }: { prototype: Prototype; resolved: ResolvedFrame } = $props();

	type Mode = 'standalone' | 'player' | 'canvas';
	let mode: Mode = 'standalone';

	const frame = $derived(resolved.frame);

	// Elements that do something on their own; clicking them never shows hotspot hints.
	// Mark anything else that handles clicks (e.g. a selectable table row) with data-pf-interactive.
	const INTERACTIVE =
		'a[href],button,input,select,textarea,label,summary,[contenteditable],[tabindex],' +
		'[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option],' +
		'[data-pf-link],[data-pf-interactive]';

	function go(to: string) {
		if (!prototype.get(to)) {
			console.warn(`[paraframe] No frame "${to}"`);
			return;
		}
		if (mode === 'player') postToHost({ type: 'paraframe:navigate', to });
		else if (mode === 'standalone') goto(prototype.paths.frame(to));
	}

	const nav: FrameNav = {
		get current() {
			return frame.id;
		},
		href: (to) => prototype.paths.play(to),
		go,
		hotspot: (to) => (node) => {
			node.dataset.pfLink = to;
			if (!node.matches('a[href],button,input,select,textarea,[tabindex]')) node.tabIndex = 0;
			if (!node.hasAttribute('role')) node.setAttribute('role', 'link');

			const onclick = (event: MouseEvent) => {
				if (event.defaultPrevented) return;
				// A button or link nested inside the hotspot handles its own click.
				const inner = (event.target as Element).closest(INTERACTIVE);
				if (inner && inner !== node) return;
				event.preventDefault();
				go(to);
			};
			const onkeydown = (event: KeyboardEvent) => {
				if (event.key === 'Enter' && event.target === node) {
					event.preventDefault();
					go(to);
				}
			};
			node.addEventListener('click', onclick);
			node.addEventListener('keydown', onkeydown);
			return () => {
				node.removeEventListener('click', onclick);
				node.removeEventListener('keydown', onkeydown);
				delete node.dataset.pfLink;
			};
		}
	};
	setFrameNav(nav);

	let hintTimer: ReturnType<typeof setTimeout> | undefined;

	function flashHints() {
		const root = document.documentElement;
		root.classList.add('pf-hints');
		clearTimeout(hintTimer);
		hintTimer = setTimeout(() => root.classList.remove('pf-hints'), 700);
	}

	function onclick(event: MouseEvent) {
		if (event.defaultPrevented || mode === 'canvas') return;
		if (!(event.target as Element).closest?.(INTERACTIVE)) flashHints();
	}

	function onkeydown(event: KeyboardEvent) {
		if (mode !== 'player' || !PLAYER_KEYS.has(event.key)) return;
		if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
		event.preventDefault();
		postToHost({ type: 'paraframe:key', key: event.key });
	}

	onMount(() => {
		const host = window.frameElement;
		mode = host?.hasAttribute('data-pf-player')
			? 'player'
			: host?.hasAttribute('data-pf-canvas')
				? 'canvas'
				: 'standalone';
		if (mode === 'standalone') return () => clearTimeout(hintTimer);

		// Tell the viewer when anything may have moved, at most once per animation
		// frame, so comment pins on elements follow them.
		let request = 0;
		const changed = () => {
			cancelAnimationFrame(request);
			request = requestAnimationFrame(() => postToHost({ type: 'paraframe:layout', frame: frame.id }));
		};
		const observer = new MutationObserver(changed);
		observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
		document.addEventListener('scroll', changed, { capture: true, passive: true });
		window.addEventListener('resize', changed);
		return () => {
			clearTimeout(hintTimer);
			cancelAnimationFrame(request);
			observer.disconnect();
			document.removeEventListener('scroll', changed, { capture: true });
			window.removeEventListener('resize', changed);
		};
	});

	$effect(() => {
		const id = frame.id;
		let cancelled = false;
		document.fonts.ready.then(() => {
			if (cancelled) return;
			// Build-time captures can distinguish a hydrated frame from its initial HTML.
			document.documentElement.dataset.pfFrameReady = id;
			postToHost({ type: 'paraframe:ready', frame: id });
		});
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.pfFrameReady;
		};
	});
</script>

<svelte:head>
	<title>{frame.title} – {prototype.title}</title>
</svelte:head>

<svelte:window {onclick} {onkeydown} />

{#key frame.id}
	<resolved.component {...frame.props} />
{/key}

<style>
	:global(html.pf-hints [data-pf-link]) {
		outline: 2px solid rgb(37 99 235 / 0.75) !important;
		outline-offset: 1px;
		box-shadow: inset 0 0 0 999px rgb(37 99 235 / 0.12) !important;
	}
</style>
