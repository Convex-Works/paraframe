<script lang="ts">
	import { onMount, untrack, type Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { setAuth, type AuthPaths, type AuthState } from './auth.js';
	import { AuthSession } from './internal/auth-session.js';

	let { paths, children }: {
		paths: AuthPaths;
		children: Snippet;
	} = $props();

	let state = $state<AuthState>({ user: null, loading: true, busy: false, error: null, configured: false });
	const session = new AuthSession(untrack(() => paths), (next) => { state = next; });
	setAuth({
		get user() { return state.user; },
		get loading() { return state.loading; },
		get busy() { return state.busy; },
		get error() { return state.error; },
		get configured() { return state.configured; },
		signIn: () => session.signIn(),
		signOut: () => session.signOut(),
		clearError: () => session.clearError()
	});

	onMount(() => {
		void session.start().then(() => {
			const url = new URL(window.location.href);
			if (url.searchParams.has('auth_error')) {
				url.searchParams.delete('auth_error');
				void goto(`${url.pathname}${url.search}${url.hash}`, { replace: true });
			}
		});
		return () => session.dispose();
	});
</script>

{@render children()}

{#if state.error}
	<div role="alert" class="pf-root fixed top-16 right-4 z-50 max-w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-pf-line bg-white p-4 font-pf text-[13px] text-pf-ink shadow-lg">
		<p>{state.error}</p>
		<div class="mt-3 flex justify-end gap-3">
			<button type="button" class="rounded px-1 text-pf-muted focus-visible:outline-pf-accent" onclick={() => session.clearError()}>Dismiss</button>
			{#if state.configured}
				<button type="button" class="rounded px-1 font-medium text-pf-accent focus-visible:outline-pf-accent" disabled={state.busy} onclick={() => session.signIn()}>Sign in again</button>
			{/if}
		</div>
	</div>
{/if}
