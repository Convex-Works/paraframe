<script lang="ts" module>
	// 24×24 stroke icons.
	const PATHS = {
		canvas: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
		'chevron-left': 'M15 6l-6 6 6 6',
		'chevron-right': 'M9 6l6 6-6 6',
		'chevron-down': 'M6 9l6 6 6-6',
		play: 'M7 5l12 7-12 7z',
		external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
		restart: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
		check: 'M5 12.5l4.5 4.5L19 7.5',
		plus: 'M12 5v14M5 12h14',
		minus: 'M5 12h14',
		fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'
	} as const;
	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d={PATHS[name]} />
</svg>
