# Development

## Scripts

```sh
pnpm showcase   # demo prototype at http://localhost:5173
pnpm dev        # rebuild dist/ on change, for apps that depend on paraframe
pnpm check      # type check (TypeScript 7 via svelte-check --tsgo)
pnpm test       # unit tests (Vitest, in tests/)
pnpm package    # build dist/ and lint the package
```

A fresh clone needs no other repositories.

To run the showcase with comments, see
[Comments › Running the showcase with comments](COMMENTS.md#running-the-showcase-with-comments).

## Layout

- [`src/lib`](../src/lib) is the package: `Canvas`, `Player`, `FrameHost`,
  `FrameLink`, `definePrototype` and helpers, and `styles.css` from
  `index.ts`, and `Comments` from `comments.ts` (`paraframe/comments`). Only
  `comments.ts` and `Comments.svelte` may import visual-comments, an optional
  peer dependency; the canvas and player use the types in
  `internal/comments.ts`.
- [`src/routes`](../src/routes) and [`src/demo`](../src/demo) in this package
  are a complete working example, served by `pnpm showcase`. `src/demo` holds
  the demo prototype, its frames and their CSS; `src/routes` wires them up as
  described in [Setup](SETUP.md#routes).
- [`tests`](../tests) holds the Vitest unit tests. They sit outside `src/lib`
  so `svelte-package` never copies them into `dist/`.

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
