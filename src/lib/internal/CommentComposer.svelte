<!--
  A comment field that grows with its text. Enter sends, Shift+Enter starts a
  new line, Escape cancels. The text clears at once and comes back if sending fails.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		variant = 'reply',
		placeholder = 'Reply',
		initial = '',
		autofocus = false,
		onsubmit,
		oncancel,
		oninput
	}: {
		/** `new` floats on the canvas; `reply` and `edit` sit inside a thread. */
		variant?: 'new' | 'reply' | 'edit';
		placeholder?: string;
		initial?: string;
		autofocus?: boolean;
		onsubmit: (body: string) => Promise<unknown> | unknown;
		oncancel?: () => void;
		oninput?: (value: string) => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let value = $state(initial);
	let sending = $state(false);
	let field = $state<HTMLTextAreaElement>();
	const empty = $derived(!value.trim());

	export function focus() {
		field?.focus();
	}

	function fit() {
		if (!field) return;
		field.style.height = 'auto';
		field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
	}

	async function submit(event?: Event) {
		event?.preventDefault();
		if (empty || sending) return;
		const body = value;
		sending = true;
		if (variant !== 'edit') value = '';
		requestAnimationFrame(fit);
		try {
			await onsubmit(body.trim());
		} catch {
			value = body;
			requestAnimationFrame(fit);
		} finally {
			sending = false;
			field?.focus();
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.isComposing) return;
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void submit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			oncancel?.();
		}
	}

	onMount(() => {
		fit();
		if (autofocus) {
			field?.focus({ preventScroll: true });
			field?.setSelectionRange(value.length, value.length);
		}
	});
</script>

<form
	onsubmit={submit}
	class={[
		'flex items-end gap-2 bg-white text-[13px] text-pf-ink transition-colors',
		variant === 'new'
			? 'w-[296px] rounded-[18px] border border-pf-comment py-[5px] pr-[5px] pl-3.5 shadow-[0_2px_14px_rgb(0_0_0/0.18)]'
			: 'rounded-[14px] border border-pf-line py-[3px] pr-[3px] pl-3 focus-within:border-pf-comment'
	]}
>
	<textarea
		bind:this={field}
		bind:value
		rows="1"
		{placeholder}
		aria-label={placeholder}
		maxlength={5000}
		{onkeydown}
		oninput={() => { fit(); oninput?.(value); }}
		class="max-h-40 min-w-0 flex-1 resize-none self-center bg-transparent py-1 leading-5 outline-none placeholder:text-pf-muted/70"
	></textarea>
	{#if variant === 'edit'}
		<button type="button" class="h-6 rounded-full px-2 text-xs text-pf-muted hover:bg-pf-wash" onclick={() => oncancel?.()}>Cancel</button>
	{/if}
	<button
		type="submit"
		disabled={empty || sending}
		aria-label={variant === 'edit' ? 'Save' : 'Send'}
		title={variant === 'edit' ? 'Save (Enter)' : 'Send (Enter)'}
		class={[
			'grid shrink-0 place-items-center rounded-full text-white transition-colors',
			variant === 'new' ? 'size-7' : 'size-6',
			empty ? 'bg-[#d9d9d9]' : 'bg-pf-comment hover:brightness-110'
		]}
	>
		<Icon name={variant === 'edit' ? 'check' : 'send'} size={variant === 'new' ? 16 : 14} />
	</button>
</form>
