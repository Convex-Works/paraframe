# Setup

paraframe is a read-only viewer for UI frames, in the style of a design tool's
prototype preview. You write each frame as a Svelte component. paraframe adds
two views around them:

- **Canvas.** Every frame laid out in sections on a board you can pan and
  zoom. Frames where a flow starts carry a tag that plays the flow. Hover live
  frames to inspect tooltips and hover states. Clicking and scrolling inside a
  frame are reserved for the player or standalone frame view; canvas gestures
  select, pan and zoom the board. Double-click a frame to play it.
- **Player.** One frame at a time, scaled to the window. Links inside frames
  move between frames. Arrow keys step through frames in reading order, and
  named flows give you starting points.

Frames are real components, so anything inside a frame can be interactive:
tabs, forms, live editors. Each frame renders in its own iframe at its own
size. Its styles, media queries and fixed elements behave as they would in the
real product, and they never leak into paraframe's chrome.

Requires SvelteKit 3 and Svelte 5. paraframe's chrome ships as plain CSS, so
your app needs no Tailwind.

## Install

In a SvelteKit app (a new one from `npx sv create --template minimal --types ts`
works):

```sh
npm i -D paraframe
```

Delete the template's root `src/routes/+page.svelte`: the canvas takes its
place at `/`, and the two would conflict.

## Define the prototype

Define the prototype once. Frames can set their own `size`, and one component
can back several frames with different `props`:

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

Each frame is an ordinary Svelte component, such as
`src/lib/frames/Welcome.svelte`, and receives the frame's `props` as its own.

## Routes

The canvas and player share a layout that loads paraframe's styles; the frame
route loads your product's styles instead.

```
src/routes/
  +layout.ts
  (viewer)/+layout.svelte
  (viewer)/+page.svelte
  (viewer)/play/[frame]/+page.ts
  (viewer)/play/[frame]/+page.svelte
  frame/[frame]/+page.ts
  frame/[frame]/+page.svelte
```

```ts
// src/routes/+layout.ts
export const prerender = true;
```

```svelte
<!-- src/routes/(viewer)/+layout.svelte -->
<script lang="ts">
	import 'paraframe/styles.css';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

{@render children()}
```

```svelte
<!-- src/routes/(viewer)/+page.svelte -->
<script lang="ts">
	import { Canvas } from 'paraframe';
	import { prototype } from '#lib/prototype.js';
</script>

<Canvas {prototype} />
```

```ts
// src/routes/(viewer)/play/[frame]/+page.ts
import { frameEntries } from 'paraframe';
import { prototype } from '#lib/prototype.js';

export const entries = () => frameEntries(prototype);
```

```svelte
<!-- src/routes/(viewer)/play/[frame]/+page.svelte -->
<script lang="ts">
	import { page } from '$app/state';
	import { Player } from 'paraframe';
	import { prototype } from '#lib/prototype.js';
</script>

<Player {prototype} frameId={page.params.frame ?? ''} />
```

```ts
// src/routes/frame/[frame]/+page.ts
import { frameEntries, resolveFrame } from 'paraframe';
import { prototype } from '#lib/prototype.js';
import type { PageLoad } from './$types';

export const entries = () => frameEntries(prototype);

export const load: PageLoad = async ({ params }) => ({
	resolved: await resolveFrame(prototype, params.frame)
});
```

```svelte
<!-- src/routes/frame/[frame]/+page.svelte -->
<script lang="ts">
	// Import your product's own CSS here, never paraframe/styles.css.
	import { FrameHost } from 'paraframe';
	import { prototype } from '#lib/prototype.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<FrameHost {prototype} resolved={data.resolved} />
```

[`src/routes`](../src/routes) and [`src/demo`](../src/demo) in this package are
a complete working example. Run `pnpm showcase` to open it.

## Static canvas previews

Pass an optional `preview` function to use images at overview scale, switching
nearby frames to live iframes when zooming beyond the image's resolution.
Hovering a thumbnail also loads its live frame so hover states work at any
zoom. Selection, navigation and the interactive player work the same way:

```svelte
<Canvas {prototype} preview={(frame) => `/previews/${frame.id}.png`} />
```

The host app supplies the images, for example by capturing each frame route in
a headless browser during its build. Use each frame's `size` as the capture
viewport. `FrameHost` sets `document.documentElement.dataset.pfFrameReady` to
the frame ID after hydration and font loading; a capture should also wait for
its images and any application-specific asynchronous content. Omit `preview`
in development to keep live frame updates.

The canvas compares the image's natural dimensions with the frame's CSS size,
canvas zoom, device-pixel ratio and native pinch zoom. Supply direct image URLs
at any capture resolution; 2× screenshots automatically switch at twice the
zoom of 1× screenshots.

Loading live frames:

- Live frames load only within 96 CSS pixels of the viewport.
- Startup waits until pan and zoom have been idle for 50 ms, then loads one
  frame at a time with a 50 ms gap after readiness.
- New gestures pause pending starts; off-screen frames and unhovered frames
  below the threshold leave the queue.
- A frame that never reports ready releases its queue slot after five seconds
  so other previews can load.

Live frames fade over their thumbnail after load and the frame's ready message,
return to images 15% below the switch point once unhovered, and are destroyed
after fading out. This hysteresis avoids reloading around the boundary. Failed
live loads leave the thumbnail visible; failed thumbnails fall back to a live
frame.

## Theming

Override the `--pf-*` custom properties (see
[`src/styles.css`](../src/styles.css)) after importing
`paraframe/styles.css`, for example in the viewer layout:

```svelte
<style>
	:global(:root) {
		--pf-canvas: #0f172a;
		--pf-font: 'Inter', sans-serif;
	}
</style>
```

Comments take `--pf-comment`, `--pf-comment-soft`, `--pf-avatar` and
`--pf-font`.
