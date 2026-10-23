# Development

## Scripts

```sh
pnpm showcase   # demo prototype at http://localhost:5173
pnpm dev        # rebuild dist/ on change, for apps that depend on paraframe
pnpm check      # type check (TypeScript 7 via svelte-check --tsgo)
pnpm test       # unit tests (Vitest, in tests/)
pnpm package    # build dist/ (with the compiled dist/styles.css) and lint the package
pnpm css        # compile only src/styles.css into dist/styles.css
```

The showcase's comments stay in the browser; to run it against a comment
server, see
[Comments › Running the showcase with comments from a server](COMMENTS.md#running-the-showcase-with-comments-from-a-server).
The published showcase at paraframe.convex.works is built and served as
described in [DEPLOY.md](DEPLOY.md).

## Layout

- [`src/lib`](../src/lib) is the package: `Canvas`, `Player`, `FrameHost`,
  `FrameLink`, `definePrototype` and helpers from `index.ts`, and `Comments`
  from `comments.ts` (`paraframe/comments`). Only
  `comments.ts` and `Comments.svelte` may import visual-comments, an optional
  peer dependency; the canvas and player use the types in
  `internal/comments.ts`.
- [`src/styles.css`](../src/styles.css) is the chrome's Tailwind source.
  `pnpm package` compiles it, scanning `src/lib` for classes, into the
  minified `dist/styles.css` that apps import as `paraframe/styles.css`; the
  showcase imports the source directly through `@tailwindcss/vite`.
- [`src/routes`](../src/routes) and [`src/demo`](../src/demo) in this package
  are a complete working example, served by `pnpm showcase`. `src/demo` holds
  the demo prototype, its frames and their CSS; `src/routes` wires them up as
  described in [Setup](SETUP.md#routes). [`src/service-worker`](../src/service-worker)
  stands in for a comment server in the showcase
  ([Comments](COMMENTS.md#the-showcases-comments)).
- [`tests`](../tests) holds the Vitest unit tests. They sit outside `src/lib`
  so `svelte-package` never copies them into `dist/`.
- [`Dockerfile`](../Dockerfile) and [`nginx.conf`](../nginx.conf) build the
  showcase image published at paraframe.convex.works; see [DEPLOY.md](DEPLOY.md).

## No product-specific code

paraframe has no product-specific code. Keep it that way: anything about a
particular prototype belongs in the app that uses it.

## Brand assets

The logo files are in [`docs/assets/brand`](assets/brand):
`paraframe-mark.svg` (full colour), `paraframe-mark-mono.svg`
(`currentColor`), `paraframe-mark-small.svg` (for 16–32 px) and
`paraframe-logo.png` (512×512).

The README banner, `docs/assets/paraframe-banner.png`, is rendered from
[`paraframe-banner.html`](assets/brand/paraframe-banner.html): open it in
headless Chromium at a 1280×840 viewport with device scale factor 2 and
screenshot the `#banner` element. The frame images it uses are in
`docs/assets/brand/banner/`.

The link-preview cards are cropped from the same source by
[`render-cards.sh`](assets/brand/render-cards.sh) (needs Chromium):
`static/og.png` (1200×630) is the showcase's `og:image`, and
`docs/assets/paraframe-social.png` (1280×640) is the repository's social
preview on GitHub, uploaded by hand under Settings › Social preview.
