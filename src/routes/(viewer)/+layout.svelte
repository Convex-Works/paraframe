<script lang="ts">
	import '../../styles.css';
	import { Comments } from '#lib/comments.js';
	import { commentServer, demoComments } from '../../demo/comments.js';
	let { data, children } = $props();

	// `VITE_COMMENTS_SERVER=http://localhost:4400 pnpm showcase` uses that server (src/hooks.server.ts);
	// otherwise each visitor's comments stay in their browser (src/service-worker).
	const routes = commentServer ? {} : demoComments;
</script>

{#if data.comments}
	<Comments {...routes}>
		{@render children()}
	</Comments>
{:else}
	{@render children()}
{/if}
