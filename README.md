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

## OIDC authentication

Authentication is optional. Without a provider, paraframe has no account
controls. With a provider, anyone can still view the prototype; signing in
shows the teal avatar menu in the canvas and player.

The browser uses same-origin server endpoints and receives user details only:

```svelte
<!-- src/routes/(viewer)/+layout.svelte -->
<script lang="ts">
  import 'paraframe/styles.css';
  import { AuthProvider } from 'paraframe';
  import { resolve } from '$app/paths';
  let { children } = $props();
</script>

<AuthProvider paths={{
  session: `${resolve('')}auth/session`,
  login: `${resolve('')}auth/login`,
  logout: `${resolve('')}auth/logout`
}}>
  {@render children()}
</AuthProvider>
```

In server-only code, import `ServerOidcAuth` from `paraframe/server` and supply
`authority`, `clientId`, `clientSecret`, `sessionSecret` and optionally
`canvasPath` (default `/`). The session secret must be a random value of at
least 32 characters. Store both secrets in private runtime environment
variables. `handle(event)` accepts a SvelteKit request event and returns a
response for login, session, logout and canvas callback requests; it returns
`undefined` for other requests. The host mounts `auth/[action]/+server.ts` and
intercepts callback queries at the canvas in `hooks.server.ts`. See the host
prototype for a complete integration. Set SvelteKit `paths.relative: false`
when using `resolve` for these endpoints. In a callback hook, throw SvelteKit
`redirect(303, response.headers.get('location'))` so pending cookies are
attached to the redirect response.

Use a **confidential client** with authorization code flow and **S256 PKCE**.
Register the exact absolute canvas URL as both the redirect URL and
post-logout redirect URL, including its trailing slash and deployment base
path. Keep the canvas route dynamic so the server can process callbacks.
Frames and preview images can still be prerendered. This integration requires
a server adapter; a static-only host cannot perform confidential token
exchanges.

The default scopes are `openid profile email offline_access`. The server
validates state, PKCE, nonce, issuer, audience, authorized party, expiry and ID
token signatures. Pending transactions expire after ten minutes and are
consumed once. Sessions use authenticated encryption in HttpOnly, SameSite=Lax
cookies, with Secure enabled on HTTPS. Tokens never enter browser JavaScript
or storage. The session cookie has a seven-day maximum lifetime; access/ID
token validity is checked independently and refresh tokens renew on the server.
Cookies exceeding 3,800 bytes are rejected. Logout requires a same-origin POST,
clears local cookies, then redirects to the discovered end-session endpoint.

Concurrent refreshes are coalesced within one server process. Deploy a single
Node instance, or add a shared session/refresh store before running multiple
instances with rotating refresh tokens. Share the encryption key across server
restarts; rotating it signs existing sessions out.

`useAuth()` exposes the reactive user (`sub`, `name`, `email`, `picture`),
loading/busy/error state, and `signIn()`, `signOut()` and `clearError()` methods.
The avatar uses the profile picture when available and otherwise the user's
first initial. Theme its teal circle with `--pf-avatar`.

```sh
pnpm test # OIDC flow, cookie security, renewal and logout; comment storage and endpoints
```

## Comments

Optional, like authentication. Viewers press **C** (or the speech-bubble
button) to enter comment mode in the canvas or player:

- Click a frame to drop a pin and write the first comment. Enter sends,
  Shift+Enter starts a new line, Escape cancels.
- Near an element, the pin is pulled onto it and the element is outlined,
  like a tablet pointer over a button. The comment cursor (drawn, not a
  system cursor) becomes a faint dot, joined to the outline by a neck that
  thins as it stretches while the pointer is outside the element. Under the pointer, the innermost
  element that means something wins: a control, image or chart, a heading,
  paragraph, cell or other text, then a group or a visible box. Wrappers
  that only lay things out are skipped, and compact controls (up to
  480 × 56 px) take in their icon and text. A smaller element within 14
  screen pixels pulls the pointer onto it if it sits inside the element
  under the pointer. Open space, and anything covering more than 60% of the
  frame, takes a free pin. Hold Alt (Option) to place a free pin anywhere.
- The new comment names its element ("On cell “1” in “Search
  results”"). ⌥↑ or the up arrow widens it to the element around it, ⌥↓
  narrows it back, and × pins to the point instead. The thread stores the
  element's label, visible text, a CSS selector and its box (`anchor`), and
  outlines that box while the thread is open.
- In a live frame, a pin on an element follows it as the frame scrolls or
  changes, and hides while the element is out of view: scrolled away,
  clipped by a scrolling container, or under something (a sticky header).
  Opening its thread scrolls the element back into view. Frames report
  scrolls and changes to the viewer (`paraframe:layout`), so nothing polls.
  If the element can no longer be found (its selector or text changed), the
  pin hides and the thread opens from the comments panel at its saved spot.
  Free pins, and pins on image previews, stay where they were placed.
- In comment mode the player passes wheel turns to whatever scrolls inside
  the frame under the pointer, so long pages and tables can be read and
  commented on.
- Frames can mark something to comment on as a whole, and name it, with
  `data-pf-comment="Name"`. Elements are found only in live frames: on the
  canvas, frames still shown as preview images take free pins.
- Pins show on frames at all times, with the author's avatar. They pop out
  of the point they mark when they appear and shrink back into it when they
  go (none of that with reduced motion). Hovering grows a pin into a preview of the
  first comment; clicking opens the thread to reply, resolve, edit or delete.
- The comments panel lists every thread with search, sort (date or frame),
  resolved and "only your threads" filters, and unread markers. Choosing a
  thread in the canvas glides the view to its frame; in the player it
  switches frames.
- "Copy link" gives a canvas URL ending `#comment-<id>` that opens the thread.
- Other viewers' changes arrive live over server-sent events.
- Images can be dropped on any comment field, or pasted into it: PNG,
  JPEG, GIF or WebP, up to 10 MB each and six per comment. They upload at
  once and show as thumbnails; a comment can be images alone. In the thread
  they show under the text, and open full size in a new tab. Edit a comment
  to remove one. Images are stored in the same SQLite file (`images` table)
  and served at `<path>/images/<id>` to whoever can read comments. Uploads
  never sent with a comment are deleted after a day. The server checks each
  file's first bytes, never accepts SVG, and serves images with `nosniff` and
  a sandboxing CSP. Allow request bodies of 10 MB at the comment path:
  adapter-node's `BODY_SIZE_LIMIT` (512 KB by default) and any proxy in front.

Comments are stored in SQLite through Node's built-in `node:sqlite` (Node
22.13+ without flags; no native dependency).

Each comment endpoint keeps one database for the life of the server process,
even across module reloads in development. If its `database` changes while
the server runs, or the file is deleted or replaced under it, comment
requests fail with 503 and a message to restart, instead of quietly showing
other comments or writing to a file no longer on disk. Read `database` from
the process environment (`process.env`), not SvelteKit's `$app/env/private`:
in development SvelteKit shares the latter between dev servers through a
generated file. Add the provider inside
`AuthProvider`:

```svelte
<AuthProvider paths={…}>
  <CommentsProvider path="{resolve('')}comments">
    {@render children()}
  </CommentsProvider>
</AuthProvider>
```

and mount the server endpoints at that path:

```ts
// src/lib/server/comments.ts
import { ServerComments } from 'paraframe/server';
export const comments = new ServerComments<RequestEvent>({
  database: 'data/comments.sqlite', // created on first request
  path: '/comments',
  user: (event) => auth.user(event)  // ServerOidcAuth, or any { sub, name, picture? } | null
});

// src/routes/comments/[...path]/+server.ts  (GET, POST, PATCH, DELETE)
const handle: RequestHandler = async (event) =>
  await comments.handle(event) ?? new Response('Not found', { status: 404 });
```

Reading and writing require a user by default; pass `public: true` to let
signed-out viewers read. Writes require a same-origin JSON request. Anyone
signed in can reply and resolve; only authors edit or delete their comments,
and deleting a thread's first comment deletes the thread. Pins are stored in
frame pixels, so they stay put at any zoom. Read state is per user. Live
updates are in-process: serve a single Node instance, as for authentication.
Theme the comment blue with `--pf-comment` and `--pf-comment-soft`.

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
