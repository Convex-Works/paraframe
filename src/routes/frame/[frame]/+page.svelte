<script lang="ts">
	import '../../../demo/frame.css';
	import { FrameHost } from '#lib';
	import { prototype } from '../../../demo/prototype.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<FrameHost {prototype} resolved={data.resolved} />
