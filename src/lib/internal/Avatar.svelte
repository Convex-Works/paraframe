<!-- A person's profile picture, or their initial on a colour of their own. -->
<script lang="ts" module>
	// Others get a stable colour from their id; the viewer keeps the account colour.
	const COLORS = ['#7b61ff', '#f24822', '#14ae5c', '#ffa629', '#0d99ff', '#e5487d', '#667799'];

	function colorFor(sub: string) {
		let hash = 0;
		for (const char of sub) hash = (hash * 31 + char.codePointAt(0)!) | 0;
		return COLORS[Math.abs(hash) % COLORS.length];
	}
</script>

<script lang="ts">
	import { useAuth } from '../auth.js';

	let { user, size = 24, class: className = '' }: {
		user: { sub: string; name: string; picture?: string };
		size?: number;
		class?: string;
	} = $props();

	const auth = useAuth();
	let failed = $state<string>();
	const initial = $derived(Array.from(user.name.trim() || '?')[0].toLocaleUpperCase());
	const self = $derived(auth?.user?.sub === user.sub);
</script>

<span
	class={['flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none text-white select-none', className]}
	style:width="{size}px"
	style:height="{size}px"
	style:font-size="{Math.round(size * 0.5)}px"
	style:background={self ? 'var(--pf-avatar)' : colorFor(user.sub)}
	aria-hidden="true"
>
	{#if user.picture && user.picture !== failed}
		<img src={user.picture} alt="" referrerpolicy="no-referrer" class="size-full object-cover" draggable="false"
			onerror={() => { failed = user.picture; }} />
	{:else}
		{initial}
	{/if}
</span>
