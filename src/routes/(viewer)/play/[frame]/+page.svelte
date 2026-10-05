<script lang="ts">
	import { page } from '$app/state';
	import { Player } from '#lib';
	import { prototype } from '../../../../demo/prototype.js';
</script>

<Player {prototype} frameId={page.params.frame ?? ''} />
