<!-- An open thread: its comments, a reply field, and resolve and delete actions. -->
<script lang="ts">
	import { tick } from 'svelte';
	import { useComments, type CommentThread } from '../comments.js';
	import Avatar from './Avatar.svelte';
	import CommentComposer from './CommentComposer.svelte';
	import Icon from './Icon.svelte';
	import Menu from './Menu.svelte';
	import MenuItem from './MenuItem.svelte';
	import { ago, fullDate } from './time.js';

	let { thread, frameTitle, link, maxHeight, onclose }: {
		thread: CommentThread;
		frameTitle: string;
		/** Absolute URL that opens this thread. */
		link?: string;
		maxHeight: number;
		onclose: () => void;
	} = $props();

	const comments = useComments()!;
	const viewer = $derived(comments.viewer);
	const isAuthor = $derived(thread.comments[0]?.author.sub === viewer?.sub);
	let editing = $state<number>();
	let list = $state<HTMLOListElement>();

	// Follow the conversation to its newest comment.
	$effect(() => {
		void thread.comments.length;
		void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
	});

	async function remove(commentId: number, first: boolean) {
		if (first && !confirm('Delete this thread and all its replies?')) return;
		await comments.removeComment(commentId);
	}

	function copyLink() {
		if (link) void navigator.clipboard?.writeText(link);
	}
</script>

<div
	data-pf-ui
	role="dialog"
	aria-label="Comment #{thread.id}"
	class="pointer-events-auto flex w-[320px] cursor-default flex-col overflow-hidden rounded-[12px] bg-white text-[13px] text-pf-ink shadow-[0_4px_24px_rgb(0_0_0/0.22)]"
	style:max-height="{maxHeight}px"
>
	<header class="flex h-11 shrink-0 items-center gap-0.5 border-b border-pf-line/70 pr-1.5 pl-3.5">
		<p class="min-w-0 flex-1 truncate text-pf-muted">#{thread.id} · {frameTitle}</p>
		{#if viewer}
			<Menu label="Thread options" align="end" class="pf-tool-light size-7 rounded-full">
				{#snippet trigger()}<Icon name="more" />{/snippet}
				{#snippet children(close)}
					<MenuItem onselect={() => { close(); void comments.markRead(thread.id, false); onclose(); }}>Mark as unread</MenuItem>
					{#if link}<MenuItem onselect={() => { close(); copyLink(); }}>Copy link</MenuItem>{/if}
					{#if isAuthor}
						<MenuItem onselect={() => { close(); void remove(thread.comments[0].id, true); }}>Delete thread…</MenuItem>
					{/if}
				{/snippet}
			</Menu>
			<button
				type="button"
				class={['pf-tool-light size-7 rounded-full', thread.resolvedAt && 'text-pf-comment']}
				aria-pressed={Boolean(thread.resolvedAt)}
				title={thread.resolvedAt ? 'Reopen' : 'Resolve'}
				aria-label={thread.resolvedAt ? 'Reopen' : 'Resolve'}
				onclick={() => {
					const resolving = !thread.resolvedAt;
					void comments.resolve(thread.id, resolving);
					if (resolving) onclose();
				}}
			>
				<Icon name="resolve" size={18} />
			</button>
		{/if}
		<button type="button" class="pf-tool-light size-7 rounded-full" title="Close (Esc)" aria-label="Close" onclick={onclose}>
			<Icon name="close" />
		</button>
	</header>

	{#if thread.resolvedAt}
		<p class="shrink-0 border-b border-pf-line/70 bg-pf-comment-soft px-3.5 py-1.5 text-xs text-pf-ink">
			Resolved{thread.resolvedBy ? ` by ${thread.resolvedBy.name}` : ''}, {ago(thread.resolvedAt, comments.now)}
		</p>
	{/if}

	<ol bind:this={list} data-pf-scroll class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-1">
		{#each thread.comments as comment, index (comment.id)}
			{@const own = comment.author.sub === viewer?.sub}
			<li class={['group flex gap-2.5 py-2.5', comment.pending && 'opacity-60']}>
				<Avatar user={comment.author} size={24} />
				<div class="min-w-0 flex-1">
					<div class="flex h-6 items-center gap-1.5">
						<p class="min-w-0 truncate">
							<span class="font-medium">{comment.author.name}</span>
							<time class="ml-1 text-pf-muted" datetime={new Date(comment.createdAt).toISOString()} title={fullDate(comment.createdAt)}>
								{comment.pending ? 'sending…' : ago(comment.createdAt, comments.now)}
							</time>
							{#if comment.editedAt}<span class="text-pf-muted" title={fullDate(comment.editedAt)}> · edited</span>{/if}
						</p>
						{#if own && !comment.pending && editing !== comment.id}
							<div class="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
								<Menu label="Comment options" align="end" class="pf-tool-light size-6 rounded-full">
									{#snippet trigger()}<Icon name="more" size={14} />{/snippet}
									{#snippet children(close)}
										<MenuItem onselect={() => { close(); editing = comment.id; }}>Edit</MenuItem>
										<MenuItem onselect={() => { close(); void remove(comment.id, index === 0); }}>
											{index === 0 ? 'Delete thread…' : 'Delete'}
										</MenuItem>
									{/snippet}
								</Menu>
							</div>
						{/if}
					</div>
					{#if editing === comment.id}
						<div class="mt-1">
							<CommentComposer
								variant="edit"
								placeholder="Edit comment"
								initial={comment.body}
								autofocus
								onsubmit={async (body) => {
									await comments.edit(comment.id, body);
									editing = undefined;
								}}
								oncancel={() => (editing = undefined)}
							/>
						</div>
					{:else}
						<p class="break-words whitespace-pre-wrap">{comment.body}</p>
					{/if}
				</div>
			</li>
		{/each}
	</ol>

	{#if viewer}
		<footer class="flex shrink-0 items-start gap-2.5 border-t border-pf-line/70 px-3.5 py-3">
			<Avatar user={viewer} size={24} class="mt-[3px]" />
			<div class="min-w-0 flex-1">
				{#key thread.id}
					<CommentComposer placeholder="Reply" autofocus onsubmit={(body) => comments.reply(thread.id, body)} oncancel={onclose} />
				{/key}
			</div>
		</footer>
	{/if}
</div>
