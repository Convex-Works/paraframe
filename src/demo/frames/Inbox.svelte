<script lang="ts">
	import { useFrameNav } from '#lib';
	import { messages } from '../messages.js';

	let { compact = false }: { compact?: boolean } = $props();
	const nav = useFrameNav();
	const target = $derived(compact ? 'phone-message' : 'message');
</script>

<main class="mx-auto max-w-3xl p-6">
	<h1 class="mb-4 text-2xl font-semibold">Inbox</h1>
	<ul class="divide-y rounded-lg border">
		{#each messages as message (message.subject)}
			<li {@attach nav.hotspot(target)} class="cursor-pointer p-4 hover:bg-gray-50">
				<p class="font-medium">{message.from}: {message.subject}</p>
				<p class="text-sm text-gray-500">{message.preview}</p>
			</li>
		{/each}
	</ul>
</main>
