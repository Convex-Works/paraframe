<script lang="ts">
	import { useAuth } from '../auth.js';
	import Avatar from './Avatar.svelte';
	import Icon from './Icon.svelte';
	import Menu from './Menu.svelte';
	import MenuItem from './MenuItem.svelte';

	let { tone = 'light' }: { tone?: 'light' | 'dark' } = $props();
	const auth = useAuth();
</script>

{#if auth}
	{#if auth.user}
		<Menu label={`Account: ${auth.user.name}`} align="end" class="pf-account">
			{#snippet trigger()}
				{#if auth.user}<Avatar user={auth.user} size={32} />{/if}
				<Icon name="chevron-down" size={14} />
			{/snippet}
			{#snippet children(close)}
				<div class="max-w-72 border-b border-pf-line px-3 py-2">
					<p class="truncate font-medium">{auth.user?.name}</p>
					{#if auth.user?.email}<p class="mt-0.5 truncate text-xs text-pf-muted">{auth.user.email}</p>{/if}
				</div>
				<MenuItem onselect={() => { close(); void auth.signOut(); }}>Sign out</MenuItem>
			{/snippet}
		</Menu>
	{:else}
		<button type="button" class={['rounded-full px-3 text-[13px] font-medium', tone === 'dark' ? 'pf-tool' : 'pf-tool-light']}
			disabled={auth.loading || auth.busy} aria-label="Sign in to paraframe" onclick={() => auth.signIn()}>
			{auth.loading ? 'Connecting…' : auth.busy ? 'Redirecting…' : 'Sign in'}
		</button>
	{/if}
{/if}
