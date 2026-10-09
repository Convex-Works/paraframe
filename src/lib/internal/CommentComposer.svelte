<!--
  A comment field that grows with its text. Enter sends, Shift+Enter starts a
  new line, Escape cancels. The text clears at once and comes back if sending fails.
  Images dropped on it or pasted into it upload at once and show as thumbnails;
  a comment can be images alone.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { useComments, type CommentImage } from '../comments.js';
	import Icon from './Icon.svelte';
	import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES } from './image-limits.js';

	let {
		variant = 'reply',
		placeholder = 'Reply',
		initial = '',
		initialImages = [],
		autofocus = false,
		onsubmit,
		oncancel,
		oninput,
		onimages
	}: {
		/** `new` floats on the canvas; `reply` and `edit` sit inside a thread. */
		variant?: 'new' | 'reply' | 'edit';
		placeholder?: string;
		initial?: string;
		/** The images of a comment being edited. */
		initialImages?: CommentImage[];
		autofocus?: boolean;
		onsubmit: (body: string, images: CommentImage[]) => Promise<unknown> | unknown;
		oncancel?: () => void;
		oninput?: (value: string) => void;
		/** How many images the field holds, as it changes. */
		onimages?: (count: number) => void;
	} = $props();

	interface Attachment {
		key: number;
		/** A local object URL while it uploads, then wherever it is shown from. */
		preview: string;
		/** Set once uploaded. */
		image?: CommentImage;
		error?: string;
	}

	const comments = useComments()!;
	// svelte-ignore state_referenced_locally
	let value = $state(initial);
	// svelte-ignore state_referenced_locally
	let attachments = $state<Attachment[]>(initialImages.map((image, key) => ({ key, preview: comments.imageUrl(image), image })));
	// svelte-ignore state_referenced_locally
	let nextKey = initialImages.length;
	let sending = $state(false);
	let dragging = $state(false);
	let field = $state<HTMLTextAreaElement>();
	let form = $state<HTMLFormElement>();
	const uploading = $derived(attachments.some((a) => !a.image && !a.error));
	const empty = $derived(!value.trim() && !attachments.some((a) => a.image));
	const blocked = $derived(empty || sending || uploading || attachments.some((a) => a.error));

	$effect(() => onimages?.(attachments.length));

	export function focus() {
		field?.focus();
	}

	function fit() {
		if (!field) return;
		field.style.height = 'auto';
		field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
	}

	function add(files: Iterable<File>) {
		for (const file of files) {
			if (!IMAGE_TYPES.includes(file.type)) {
				comments.error = 'Only PNG, JPEG, GIF and WebP images can be added.';
				continue;
			}
			if (attachments.length >= MAX_IMAGES) {
				comments.error = `A comment can have up to ${MAX_IMAGES} images.`;
				break;
			}
			const key = nextKey++;
			attachments.push({ key, preview: URL.createObjectURL(file) });
			void upload(key, file);
		}
		field?.focus();
	}

	async function upload(key: number, file: File) {
		const update = (change: Partial<Attachment>) => {
			const attachment = attachments.find((a) => a.key === key);
			if (attachment) Object.assign(attachment, change);
		};
		if (file.size > MAX_IMAGE_BYTES) {
			update({ error: `Larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB` });
			return;
		}
		try {
			const bitmap = await createImageBitmap(file).catch(() => {
				throw new Error('Not a readable image');
			});
			const { width, height } = bitmap;
			bitmap.close();
			update({ image: await comments.upload(file, width, height) });
		} catch (error) {
			update({ error: (error as Error).message });
		}
	}

	function release(list: Attachment[]) {
		for (const a of list) if (a.preview.startsWith('blob:')) URL.revokeObjectURL(a.preview);
	}

	function remove(key: number) {
		release(attachments.filter((a) => a.key === key));
		attachments = attachments.filter((a) => a.key !== key);
		field?.focus();
	}

	onDestroy(() => release(attachments));

	const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

	function ondragover(event: DragEvent) {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		event.dataTransfer!.dropEffect = 'copy';
		dragging = true;
	}

	function ondragleave(event: DragEvent) {
		if (!form?.contains(event.relatedTarget as Node | null)) dragging = false;
	}

	function ondrop(event: DragEvent) {
		if (!carriesFiles(event)) return;
		event.preventDefault();
		dragging = false;
		add(event.dataTransfer!.files);
	}

	function onpaste(event: ClipboardEvent) {
		const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
		if (!files.length) return;
		event.preventDefault();
		add(files);
	}

	async function submit(event?: Event) {
		event?.preventDefault();
		if (blocked) return;
		const body = value;
		const sent = attachments;
		sending = true;
		if (variant !== 'edit') {
			value = '';
			attachments = [];
		}
		requestAnimationFrame(fit);
		try {
			await onsubmit(body.trim(), sent.map((a) => a.image!));
			if (variant !== 'edit') release(sent);
		} catch {
			value = body;
			attachments = sent;
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
	bind:this={form}
	onsubmit={submit}
	{ondragover}
	ondragenter={ondragover}
	{ondragleave}
	{ondrop}
	class={[
		'flex flex-col bg-white text-[13px] text-pf-ink transition-colors',
		variant === 'new'
			? 'w-[296px] rounded-[18px] border border-pf-comment py-[5px] pr-[5px] pl-3.5 shadow-[0_2px_14px_rgb(0_0_0/0.18)]'
			: 'rounded-[14px] border border-pf-line py-[3px] pr-[3px] pl-3 focus-within:border-pf-comment',
		dragging && 'border-pf-comment! bg-pf-comment-soft ring-2 ring-pf-comment/30'
	]}
>
	{#if attachments.length}
		<ul class="flex flex-wrap gap-1.5 pt-1.5 pr-1.5 pb-1" aria-label="Images">
			{#each attachments as attachment (attachment.key)}
				<li class="relative size-14 overflow-hidden rounded-lg border border-pf-line bg-pf-surface" title={attachment.error}>
					<img src={attachment.preview} alt="" class={['size-full object-cover', !attachment.image && 'opacity-50']} />
					{#if attachment.error}
						<span class="absolute inset-0 grid place-items-center bg-white/85 px-1 text-center text-[10px] leading-tight font-medium text-red-600">
							Not added
						</span>
					{:else if !attachment.image}
						<span class="absolute inset-0 m-auto size-4 animate-spin rounded-full border-2 border-pf-comment border-t-transparent" aria-label="Uploading"></span>
					{/if}
					<button
						type="button"
						class="absolute top-0.5 right-0.5 grid size-4 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
						aria-label="Remove image"
						title="Remove"
						onclick={() => remove(attachment.key)}
					>
						<Icon name="close" size={10} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<div class="flex items-end gap-2">
		<textarea
			bind:this={field}
			bind:value
			rows="1"
			{placeholder}
			aria-label={placeholder}
			maxlength={5000}
			{onkeydown}
			{onpaste}
			oninput={() => { fit(); oninput?.(value); }}
			class="max-h-40 min-w-0 flex-1 resize-none self-center bg-transparent py-1 leading-5 outline-none placeholder:text-pf-muted/70"
		></textarea>
		{#if variant === 'edit'}
			<button type="button" class="h-6 rounded-full px-2 text-xs text-pf-muted hover:bg-pf-wash" onclick={() => oncancel?.()}>Cancel</button>
		{/if}
		<button
			type="submit"
			disabled={blocked}
			aria-label={variant === 'edit' ? 'Save' : 'Send'}
			title={uploading ? 'Uploading images…' : variant === 'edit' ? 'Save (Enter)' : 'Send (Enter)'}
			class={[
				'grid shrink-0 place-items-center rounded-full text-white transition-colors',
				variant === 'new' ? 'size-7' : 'size-6',
				blocked ? 'bg-[#d9d9d9]' : 'bg-pf-comment hover:brightness-110'
			]}
		>
			<Icon name={variant === 'edit' ? 'check' : 'send'} size={variant === 'new' ? 16 : 14} />
		</button>
	</div>
</form>
