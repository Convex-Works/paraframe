<script lang="ts">
	import '#lib/styles.css';
	import { Comments } from '#lib';
	let { children } = $props();

	// `VITE_COMMENTS_SERVER=http://localhost:4400 pnpm showcase` adds comments, in the server's `demo` space.
	const server = import.meta.env.VITE_COMMENTS_SERVER as string | undefined;
</script>

{#if server}
	<Comments {server} space={import.meta.env.VITE_COMMENTS_SPACE ?? 'demo'}>
		{@render children()}
	</Comments>
{:else}
	{@render children()}
{/if}
