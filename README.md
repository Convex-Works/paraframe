![paraframe — Click through your Svelte prototypes.](https://raw.githubusercontent.com/Convex-Works/paraframe/main/docs/assets/paraframe-banner.png)

<p align="center">
  <a href="https://paraframe.convex.works">Showcase</a> ·
  <a href="https://github.com/Convex-Works/paraframe/blob/main/docs/SETUP.md">Setup</a> ·
  <a href="https://github.com/Convex-Works/paraframe/blob/main/docs/COMMENTS.md">Comments</a> ·
  <a href="https://github.com/Convex-Works/paraframe/blob/main/docs/DEVELOPMENT.md">Development</a>
</p>

paraframe is a read-only viewer for UI frames, in the style of a design tool's
prototype preview. You write each frame as a Svelte component, and paraframe
lays them out on a canvas and plays them one at a time. Frames are real
components, so anything inside them stays interactive.

Try the showcase at <https://paraframe.convex.works>.

- **Canvas.** Every frame in sections on a board you can pan and zoom.
- **Player.** One frame at a time, scaled to the window; named flows give you starting points.
- **Real components in iframes.** Each frame renders at its own size, with its own styles, media queries and fixed elements, isolated from paraframe's chrome.
- **Frame links.** Links, hotspots on any element, and navigation from code.
- **Static previews.** Optional images at overview scale that switch to live frames as you zoom in.
- **Comments.** Optional pinned threads on elements inside frames, through [visual-comments](https://github.com/Convex-Works/visual-comments).
- **Theming.** `--pf-*` custom properties for the chrome.

Requires SvelteKit 3 and Svelte 5. The chrome ships as plain CSS, so your app
needs no Tailwind.

## Quickstart

In a SvelteKit app (a new one from `npx sv create --template minimal --types ts`
works), install paraframe and delete the template's root
`src/routes/+page.svelte`: the canvas takes its place at `/`.

```sh
npm i -D paraframe
```

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
			frames: [{ id: 'welcome', title: 'Welcome', load: () => import('./frames/Welcome.svelte') }]
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

Each frame is an ordinary Svelte component:

```svelte
<!-- src/lib/frames/Welcome.svelte -->
<main>
	<h1>Welcome</h1>
	<p>Your first frame.</p>
</main>
```

Then add the routes. The canvas and player share a layout that loads
paraframe's styles; the frame route loads your product's styles instead.

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

[Setup](https://github.com/Convex-Works/paraframe/blob/main/docs/SETUP.md) covers
frame sizes and props, static previews and theming.
To send someone a link, [Share it](https://github.com/Convex-Works/paraframe/blob/main/docs/SETUP.md#share-it)
builds the prototype as a static site and deploys it to GitHub Pages.

To see a complete working prototype, clone this repository and run
`pnpm install && pnpm showcase`.

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
clicks inside the frame (a selectable table row, say), add `data-pf-interactive` to it.

## Keys

| View | Keys |
| --- | --- |
| Player | ← → previous and next frame, R restart the flow (while one is playing), C comment mode, Esc close the open comment, then leave comment mode |
| Canvas | Scroll or drag to pan, ⌘/Ctrl + scroll to zoom, ⇧1 fit all, ⇧0 100%, F or ⇧2 center and fit the selection, ← → select previous and next frame, Enter play (when no button or link has focus), C comment mode, Esc close the open comment, then leave comment mode |

On the canvas, hover live frames to inspect tooltips and hover states, and
double-click a frame to play it.

## Screenshots

![The canvas: every frame of a prototype, in Desktop and Phone sections, with comment pins](https://raw.githubusercontent.com/Convex-Works/paraframe/main/docs/assets/screenshots/canvas-overview.png)

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/Convex-Works/paraframe/main/docs/assets/screenshots/canvas-zoom.png" alt="Zoomed in on the canvas, hovering a live frame" /><br />Zoom in and frames are live: hover states and tooltips work.</td>
    <td width="50%"><img src="https://raw.githubusercontent.com/Convex-Works/paraframe/main/docs/assets/screenshots/player.png" alt="The player stepping through a flow" /><br />The player, partway through a flow.</td>
  </tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/Convex-Works/paraframe/main/docs/assets/screenshots/comments-player.png" alt="Comment threads in the player" /><br />Comments pinned to elements, with the thread list beside the frame.</td>
    <td><img src="https://raw.githubusercontent.com/Convex-Works/paraframe/main/docs/assets/screenshots/comments-canvas.png" alt="Comment mode on the canvas" /><br />Every thread across the prototype, from the canvas.</td>
  </tr>
</table>

The screenshots show an example invoicing prototype; `pnpm showcase` runs a
smaller one.

## Comments

Optional. Comments come from a [visual-comments](https://github.com/Convex-Works/visual-comments) server
through your prototype's own server, which also signs viewers in. Install
`visual-comments` next to paraframe, wrap the viewer layout in `<Comments>`
from `paraframe/comments`, and viewers can press **C** to pin threads on
elements inside frames. Without it, paraframe needs nothing from
visual-comments. See [Comments](https://github.com/Convex-Works/paraframe/blob/main/docs/COMMENTS.md).

## How it compares

[Storybook](https://storybook.js.org) and [Histoire](https://histoire.dev)
are built around stories: each renders a component (or, in Storybook, a
page) in isolation in one state, with controls to vary its props. paraframe
shows *screens*: whole pages of your product laid out side by side like a
design file and linked into flows you can click through, so you can review a
prototype end to end or send it to someone who doesn't read code. Use both if
you like; a story is a component in one state, a frame is a screen.

## License

[MIT](https://github.com/Convex-Works/paraframe/blob/main/LICENSE)
