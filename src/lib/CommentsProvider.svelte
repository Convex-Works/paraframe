<!--
  Adds comments to the canvas and player inside it. Place it in the viewer
  layout, inside AuthProvider, and mount ServerComments at `path`.
-->
<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { setComments } from './comments.js';
	import { CommentsClient } from './internal/comments-client.svelte.js';

	let { path, children }: {
		/** Same-origin endpoint where the host mounts ServerComments. */
		path: string;
		children: Snippet;
	} = $props();

	const comments = new CommentsClient(untrack(() => path));
	setComments(comments);

	onMount(() => comments.start());
</script>

{@render children()}
