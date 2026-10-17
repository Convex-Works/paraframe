<!--
  Adds comments to the canvas and player inside it, from a visual-comments
  server. Place it in the viewer layout. Frames are the surfaces that take
  comments; every frame of the prototype shares one page of threads.
-->
<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { createVisualComments, type VisualComments } from 'visual-comments';
	import { setComments } from './comments.js';

	let { server, space, page = 'prototype', children }: {
		/** The comment server, e.g. `https://comments.convex.works`. */
		server: string;
		/** The space the prototype's threads belong to. */
		space: string;
		/** The key every frame's threads share. */
		page?: string;
		children: Snippet;
	} = $props();

	let current = $state<VisualComments>();
	setComments({ get current() { return current; } });

	onMount(() => {
		const comments = createVisualComments({
			...untrack(() => ({ server, space, page })),
			// The canvas and player have their own buttons and keys.
			toolbar: false,
			// A frame is ready once it has hydrated, not when its HTML has loaded.
			documentOf: (surface, frame) => {
				try {
					const doc = frame.contentDocument;
					return doc?.documentElement.dataset.pfFrameReady === surface.getAttribute('data-vc-surface') ? doc : undefined;
				} catch {
					return undefined;
				}
			}
		});
		current = comments;
		return () => {
			current = undefined;
			comments.destroy();
		};
	});
</script>

{@render children()}
