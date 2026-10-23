<script lang="ts">
	import '../../styles.css';
	import { Comments } from '#lib/comments.js';
	import { commentServer, demoComments } from '../../demo/comments.js';
	let { data, children } = $props();

	// `VITE_COMMENTS_SERVER=http://localhost:4400 pnpm showcase` uses that server (src/hooks.server.ts);
	// otherwise each visitor's comments stay in their browser (src/service-worker).
	const routes = commentServer ? {} : demoComments;

	const site = 'https://paraframe.convex.works';
	const title = 'paraframe — click through Svelte prototypes';
	const description =
		'Real Svelte 5 components as frames on a zoomable canvas and in a flow player, like a design file you can click through.';
</script>

<!-- Link previews for the canvas and the player. Canvas and Player set their own <title>, which wins over this one. -->
<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="paraframe" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={site + '/'} />
	<meta property="og:image" content={site + '/og.png'} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="paraframe: a canvas of frames and a flow player with a comment pin" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

{#if data.comments}
	<Comments {...routes}>
		{@render children()}
	</Comments>
{:else}
	{@render children()}
{/if}
