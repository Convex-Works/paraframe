<script lang="ts">
	import { FrameLink } from '#lib';
	import { messages } from '../messages.js';

	let { compact = false }: { compact?: boolean } = $props();
	const message = messages[0];
</script>

<main class="mx-auto max-w-3xl p-6">
	<FrameLink to={compact ? 'phone-inbox' : 'inbox'} class="text-sm text-blue-700">Back to inbox</FrameLink>
	<h1 class="mt-4 text-2xl font-semibold">{message.subject}</h1>
	<p class="mt-1 text-gray-500">From {message.from}</p>
	<p class="mt-6">{message.preview}</p>
	{#if !compact}
		<FrameLink to="reply" class="mt-8 inline-block rounded bg-blue-700 px-4 py-2 text-white">Reply</FrameLink>
	{/if}
</main>
