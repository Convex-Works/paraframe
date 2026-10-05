<!-- A link to another frame. Modified clicks (new tab, etc.) open the player at that frame. -->
<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import { useFrameNav } from './nav.js';

	let { to, children, ...rest }: { to: string } & Omit<HTMLAnchorAttributes, 'href'> = $props();

	const nav = useFrameNav();

	function onclick(event: MouseEvent) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
		event.preventDefault();
		nav.go(to);
	}
</script>

<a {...rest} href={nav.href(to)} target="_top" data-pf-link={to} {onclick}>{@render children?.()}</a>
