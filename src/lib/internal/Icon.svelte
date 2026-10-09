<script lang="ts" module>
	// 24×24 stroke icons.
	const PATHS = {
		canvas:
			'M3 6.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M14 6.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M3 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M14 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
		'chevron-left': 'M15 6l-6 6 6 6',
		'chevron-right': 'M9 6l6 6-6 6',
		'chevron-down': 'M6 9l6 6 6-6',
		'chevron-up': 'M6 15l6-6 6 6',
		play: 'M7 5l12 7-12 7z',
		external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
		restart: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
		check: 'M5 12.5l4.5 4.5L19 7.5',
		plus: 'M12 5v14M5 12h14',
		minus: 'M5 12h14',
		fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
		comment: 'M12 3.5a8.5 8.5 0 1 1 0 17H3.5V12A8.5 8.5 0 0 1 12 3.5z',
		search: 'M11 4.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13zM20 20l-4.4-4.4',
		filter: 'M4 7h16M7 12h10M10 17h4',
		more: 'M5 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2zM12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2zM19 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z',
		resolve: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM8 12.2l2.7 2.7L16 9.6',
		close: 'M6 6l12 12M18 6L6 18',
		send: 'M12 19V5M6.5 10.5L12 5l5.5 5.5'
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
