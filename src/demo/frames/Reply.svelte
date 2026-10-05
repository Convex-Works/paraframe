<script lang="ts">
	import { FrameLink } from '#lib';
	let body = $state('');
</script>

<main class="mx-auto max-w-3xl p-6">
	<h1 class="text-2xl font-semibold">Reply</h1>
	<textarea bind:value={body} class="mt-4 h-48 w-full rounded border p-3" placeholder="Write a reply"></textarea>
	<p class="mt-1 text-sm text-gray-500">{body.length} characters</p>
	<FrameLink to="inbox" class="mt-4 inline-block rounded bg-blue-700 px-4 py-2 text-white">Send</FrameLink>
</main>
