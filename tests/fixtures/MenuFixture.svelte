<!-- A Menu with three radio items, as the Scale and Flows menus use it. -->
<script lang="ts">
	import Menu from '../../src/lib/internal/Menu.svelte';
	import MenuItem from '../../src/lib/internal/MenuItem.svelte';

	let { value = $bindable('b') }: { value?: string } = $props();
</script>

<Menu label="Scale">
	{#snippet trigger()}Scale{/snippet}
	{#snippet children(close)}
		{#each ['a', 'b', 'c'] as option (option)}
			<MenuItem
				checked={option === value}
				onselect={() => {
					close();
					value = option;
				}}
			>
				{option}
			</MenuItem>
		{/each}
	{/snippet}
	{#snippet footer()}<p>Help</p>{/snippet}
</Menu>
