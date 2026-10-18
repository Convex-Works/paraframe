# paraframe

A read-only viewer for UI frames, in the style of a design tool's prototype
preview. You write each frame as a Svelte component. paraframe adds two
views around them:

- **Canvas.** Every frame laid out in sections on a board you can pan and
  zoom. Frames where a flow starts carry a tag that plays the flow.
  Hover live frames to inspect tooltips and hover states. Clicking and scrolling
  inside a frame are reserved for the player or standalone frame view; canvas
  gestures select, pan and zoom the board. Double-click a frame to play it.
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

### Static canvas previews

Pass an optional `preview` function to use images at overview scale, switching
nearby frames to live iframes when zooming beyond the image's resolution.
Hovering a thumbnail also loads its live frame so hover states work at any zoom.
Selection, navigation and the interactive player work the same way:

```svelte
<Canvas {prototype} preview={(frame) => `/previews/${frame.id}.png`} />
```

The host app supplies the images, for example by capturing each frame route in a
headless browser during its build. Use each frame's `size` as the capture viewport.
`FrameHost` sets `document.documentElement.dataset.pfFrameReady` to the frame ID
after hydration and font loading; a capture should also wait for its images and
any application-specific asynchronous content. Omit `preview` in development
to keep live frame updates.

The canvas compares the image's natural dimensions with the frame's CSS size,
canvas zoom, device-pixel ratio and native pinch zoom. Supply direct image URLs
at any capture resolution; 2× screenshots automatically switch at twice the zoom
of 1× screenshots. Live frames load only within 96 CSS pixels of the viewport.
Startup waits until pan and zoom have been idle for 50 ms, then loads one frame
at a time with a 50 ms gap after readiness. New gestures pause pending starts;
off-screen frames and unhovered frames below the threshold leave the queue.
A frame that never reports ready releases its queue slot after five seconds
so other previews can load.
They fade over their thumbnail after load and the frame's ready message, return
to images 15% below the switch point once unhovered, and are destroyed after
fading out. This hysteresis avoids reloading around the boundary. Failed live
loads leave the thumbnail visible; failed thumbnails fall back to a live frame.

## Comments

Optional. Comments come from a [visual-comments](../visual-comments) server,
through the prototype's own server, which also signs viewers in. In
`src/hooks.server.ts`, add the sign-in of
[@convex-works/sign-in](../sign-in) and visual-comments' proxy:

```ts
import { sequence } from '@sveltejs/kit/hooks';
import { createSignIn } from '@convex-works/sign-in/server';
import { commentsProxy } from 'visual-comments/server';

const signIn = createSignIn({ issuer, clientId, clientSecret, secret });
const comments = commentsProxy({ server: 'https://comments.convex.works', space: 'my-team', secret: spaceSecret });

export const handle = sequence(signIn.sveltekit(), comments.sveltekit());
```

Then wrap the viewer layout in `Comments`:

```svelte
<!-- src/routes/(viewer)/+layout.svelte -->
<script lang="ts">
  import 'paraframe/styles.css';
  import { Comments } from 'paraframe';
  let { children } = $props();
</script>

<Comments>
  {@render children()}
</Comments>
```

`Comments` takes `endpoint` (default `/_comments`) and `auth` (default
`/auth`) when the routes are elsewhere, e.g. under a base path. The canvas and player then show a comment button and the account (avatar or
Sign in) in their toolbars. Viewers press **C** or the button to enter
comment mode, and click a frame to pin a thread on the element under the
pointer. Everything else (pins, threads, replies, images, the list, live
updates) is visual-comments'.

paraframe tells visual-comments what it needs in markup:

- Each frame is a surface (`data-vc-surface` with the frame's id and title),
  and its iframe is the surface's frame (`data-vc-frame`), so pins attach to
  elements inside frames and comments only go on frames. A frame's
  document counts once it has hydrated (`data-pf-frame-ready`).
- The canvas keeps its drag-to-pan in comment mode (`data-vc-gestures`).
  Pins follow zoom and pan because surfaces are measured on screen.
- The list goes in a column the canvas and player make room for (`data-vc-panel`).
- Choosing a thread in the list glides the canvas to its frame, or switches
  the player to it. Every frame shares one page of threads (`page`, default
  `prototype`), so the list shows them all, titled and sorted by frame.

Frames can name something to comment on as a whole with
`data-vc-target="Name"` (`data-pf-comment` still works). Run the showcase
with comments against a local server, with the development sign-in:

```sh
# in visual-comments: pnpm dev
VITE_COMMENTS_SERVER=http://localhost:4400 pnpm showcase
```

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
| Player | ← → previous and next frame, R restart the flow (while one is playing), C comment mode, Esc close the open comment, then leave comment mode |
| Canvas | Scroll or drag to pan, ⌘/Ctrl + scroll to zoom, ⇧1 fit all, ⇧0 100%, F or ⇧2 center and fit the selection, ← → select previous and next frame, Enter play, C comment mode, Esc close the open comment, then leave comment mode |

## Theming

Override the `--pf-*` custom properties (see `src/lib/styles.css`) after
importing `paraframe/styles.css`. Comments take `--pf-comment`,
`--pf-comment-soft`, `--pf-avatar` and `--pf-font`.

## Develop

```sh
pnpm showcase   # demo prototype at http://localhost:5173
pnpm dev        # rebuild dist/ on change, for apps that depend on paraframe
pnpm check      # type check (TypeScript 7 via svelte-check --tsgo)
pnpm package    # build dist/ and lint the package
```

paraframe has no product-specific code. Keep it that way: anything about a
particular prototype belongs in the app that uses it.
