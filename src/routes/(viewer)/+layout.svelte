<script lang="ts">
	import '#lib/styles.css';
	import { Comments } from '#lib/comments.js';
	let { children } = $props();

	// `VITE_COMMENTS_SERVER=http://localhost:4400 pnpm showcase` adds comments; see src/hooks.server.ts.
	const comments = Boolean(import.meta.env.VITE_COMMENTS_SERVER);
</script>

{#if comments}
	<Comments>
		{@render children()}
	</Comments>
{:else}
	{@render children()}
{/if}
