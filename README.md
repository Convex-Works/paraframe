# paraframe

A read-only viewer for UI frames, in the style of a design tool's prototype
preview. You write each frame as a Svelte component. paraframe adds two
views around them:

- **Canvas.** Every frame laid out in sections on a board you can pan and
  zoom. Frames where a flow starts carry a tag that plays the flow.
  Double-click a frame to play it.
- **Player.** One frame at a time, scaled to the window. Links inside frames
  move between frames. Arrow keys step through frames in reading order, and
  named flows give you starting points.

Frames are real components, so anything inside a frame can be interactive:
tabs, forms, live editors. Each frame renders in its own iframe at its own
size. Its styles, media queries and fixed elements behave as they would in
the real product, and they never leak into paraframe's chrome.

Requires SvelteKit 3, Svelte 5 and Tailwind 4 (the chrome is built with
Tailwind).

## Use

Define the prototype once:

```ts
// src/lib/prototype.ts
import { resolve } from '$app/paths';
import { definePrototype } from 'paraframe';

export const prototype = definePrototype({
	title: 'My product',
	size: { width: 1440, height: 900 }, // default frame size
	sections: [
		{
			id: 'onboarding',
			title: 'Onboarding',
			frames: [
				{ id: 'welcome', title: 'Welcome', load: () => import('./frames/Welcome.svelte') },
				{
					id: 'welcome-phone',
					title: 'Welcome on a phone',
					size: { width: 390, height: 844 },
					props: { compact: true }, // one component can back several frames
					load: () => import('./frames/Welcome.svelte')
				}
			]
		}
	],
	flows: [{ id: 'signup', title: 'Sign up', start: 'welcome' }],
	paths: {
		canvas: () => resolve(''),
		play: (frame) => resolve(`play/${frame}`),
		frame: (frame) => resolve(`frame/${frame}`)
	}
});
```

Then add three routes. The canvas and player share a layout that loads
paraframe's styles. The frame route loads your product's styles instead.

```
src/routes/
  +layout.ts                       export const prerender = true;
  (viewer)/+layout.svelte          import 'paraframe/styles.css'
  (viewer)/+page.svelte            <Canvas {prototype} />
  (viewer)/play/[frame]/+page.ts   export const entries = () => frameEntries(prototype);
  (viewer)/play/[frame]/+page.svelte
                                   <Player {prototype} frameId={page.params.frame ?? ''} />
  frame/[frame]/+page.ts           entries, plus
                                   load = async ({ params }) => ({ resolved: await resolveFrame(prototype, params.frame) })
  frame/[frame]/+page.svelte       import your app's CSS; <FrameHost {prototype} resolved={data.resolved} />
```

`src/routes` and `src/demo` in this package are a complete working example.
Run `pnpm showcase` to open it.

## Linking frames

Inside a frame:

```svelte
<script lang="ts">
	import { FrameLink, useFrameNav } from 'paraframe';
	const nav = useFrameNav();
</script>

<FrameLink to="details">Open details</FrameLink>

<!-- Any element, e.g. a table row -->
<tr {@attach nav.hotspot('details')}>…</tr>

<!-- From code -->
<button onclick={() => nav.go('details')}>Save</button>
```

Clicking where there is no link briefly highlights everything that is one.
Buttons, inputs and links never trigger this. If another element handles
clicks inside the frame (a selectable table row, say), add
`data-pf-interactive` to it.

## Keys

| View | Keys |
| --- | --- |
| Player | ← → previous and next frame, R restart the flow (while one is playing) |
| Canvas | Scroll or drag to pan, ⌘/Ctrl + scroll to zoom, ⇧1 fit all, ⇧0 100%, ⇧2 zoom to selection, ← → select previous and next frame, Enter play |

## Theming

Override the `--pf-*` custom properties (see `src/lib/styles.css`) after
importing `paraframe/styles.css`.

## Develop

```sh
pnpm showcase   # demo prototype at http://localhost:5173
pnpm dev        # rebuild dist/ on change, for apps that depend on paraframe
pnpm check      # type check (TypeScript 7 via svelte-check --tsgo)
pnpm package    # build dist/ and lint the package
```

paraframe has no product-specific code. Keep it that way: anything about a
particular prototype belongs in the app that uses it.
