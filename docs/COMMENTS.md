# Comments

Optional. Comments come from a [visual-comments](https://github.com/Convex-Works/visual-comments) server,
through the prototype's own server, which also signs viewers in.

visual-comments is an optional peer dependency of paraframe. Add it to the
app to use comments:

```sh
pnpm add visual-comments
```

Everything that needs it is in `paraframe/comments`; the main `paraframe`
entry never imports it, so apps without comments don't install it.

## Server

In `src/hooks.server.ts`, add the sign-in of
`@convex-works/sign-in` and visual-comments' proxy. `@convex-works/sign-in` is a
private Convex Works package with no public source; comments need it plus a
running visual-comments server:

```ts
import { sequence } from '@sveltejs/kit/hooks';
import { createSignIn } from '@convex-works/sign-in/server';
import { commentsProxy } from 'visual-comments/server';

const signIn = createSignIn({ issuer, clientId, clientSecret, secret });
const comments = commentsProxy({ server: 'https://comments.convex.works', space: 'my-team', secret: spaceSecret });

export const handle = sequence(signIn.sveltekit(), comments.sveltekit());
```

## Viewer

Then wrap the viewer layout in `Comments`:

```svelte
<!-- src/routes/(viewer)/+layout.svelte -->
<script lang="ts">
  import 'paraframe/styles.css';
  import { Comments } from 'paraframe/comments';
  let { children } = $props();
</script>

<Comments>
  {@render children()}
</Comments>
```

`Comments` takes `endpoint` (default `/_comments`) and `auth` (default
`/auth`) when the routes are elsewhere, e.g. under a base path.
`useComments()`, also from `paraframe/comments`, returns visual-comments'
`VisualComments` object inside it (undefined until it has started in the
browser).

The canvas and player then show a comment button and the account (avatar or
Sign in) in their toolbars. Viewers press **C** or the button to enter comment
mode, and click a frame to pin a thread on the element under the pointer.
Everything else (pins, threads, replies, images, the list, live updates) is
visual-comments'.

## Markup contract

paraframe tells visual-comments what it needs in markup:

- Each frame is a surface (`data-vc-surface` with the frame's id and title),
  and its iframe is the surface's frame (`data-vc-frame`), so pins attach to
  elements inside frames and comments only go on frames. A frame's document
  counts once it has hydrated (`data-pf-frame-ready`).
- The canvas keeps its drag-to-pan in comment mode (`data-vc-gestures`). Pins
  follow zoom and pan because surfaces are measured on screen.
- The list goes in a column the canvas and player make room for
  (`data-vc-panel`).
- Choosing a thread in the list glides the canvas to its frame, or switches
  the player to it. Every frame shares one page of threads (`page`, default
  `prototype`), so the list shows them all, titled and sorted by frame.

Frames can name something to comment on as a whole with
`data-vc-target="Name"` (`data-pf-comment` still works).

visual-comments' own markup reference is in its docs at
[github.com/Convex-Works/visual-comments](https://github.com/Convex-Works/visual-comments).

## Theming

Comments take `--pf-comment`, `--pf-comment-soft`, `--pf-avatar` and
`--pf-font`. See [Setup › Theming](SETUP.md#theming).

## Running the showcase with comments

Run the showcase with comments against a local server, with the development
sign-in:

```sh
# in visual-comments: pnpm dev
VITE_COMMENTS_SERVER=http://localhost:4400 pnpm showcase
```

The showcase's [`src/hooks.server.ts`](../src/hooks.server.ts) adds the sign-in
and the comments proxy only when `VITE_COMMENTS_SERVER` is set. The sign-in
comes from the private `@convex-works/sign-in` package, linked from
`../sign-in`: check out the
[sign-in repository](https://git.convex.works/ConvexWorks/sign-in) next to
this one and run `pnpm install` again.
