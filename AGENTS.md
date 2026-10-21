# paraframe

A Svelte 5 / SvelteKit library: a read-only viewer for UI frames. Each frame is
a Svelte component rendered in its own iframe at its own size; paraframe adds a
pan/zoom `Canvas`, a `Player` that steps through flows, frame-to-frame links,
optional static previews, and optional comments through
[visual-comments](https://github.com/Convex-Works/visual-comments). The package
is `src/lib`; `src/routes` + `src/demo` are the showcase (`pnpm showcase`).

Rules that bite:

- No product-specific code in paraframe. Anything about a particular prototype
  belongs in the app that uses it (or in `src/demo` for the showcase).
- Chrome styles and frame styles must not leak into each other. The `(viewer)`
  layout imports `paraframe/styles.css` (compiled Tailwind, `--pf-*` properties); the
  `frame/[frame]` route imports the host app's CSS and nothing of paraframe's.
  Don't import chrome CSS into a frame or frame CSS into the viewer.
- Comment behaviour (pins, threads, replies, the list, live updates, sign-in UI)
  belongs to visual-comments. paraframe only provides the markup it reads
  (`data-vc-surface`, `data-vc-frame`, `data-vc-gestures`, `data-vc-panel`,
  `data-pf-frame-ready`); see docs/COMMENTS.md. Fix comment behaviour upstream,
  not here.
- visual-comments is an optional peer dependency. Only `src/lib/comments.ts`
  (`paraframe/comments`) and `Comments.svelte` may import it; the main entry,
  `Canvas` and `Player` use the local types in `src/lib/internal/comments.ts`.
- Theme through the `--pf-*` custom properties in `src/styles.css`; the
  comment colours map onto visual-comments' `--vc-*` there.
- `src/styles.css` is Tailwind source, kept outside `src/lib`. `pnpm package`
  compiles it into a plain, minified `dist/styles.css`, so apps need no
  Tailwind and `tailwindcss` is only a devDependency. Its `@source './lib'`
  scan finds classes by static text: write class names out in full, never
  build them from pieces at runtime.
- `.forgejo/actions/` is vendored from `ConvexWorks/ci-actions`. Never edit it;
  re-vendor with that repository's `vendor.sh`.
- `pnpm check`, `pnpm test` and `pnpm package` must pass before committing.
  Tests live in `tests/` (Vitest), outside `src/lib`, so they never ship.

Further reading:

- [README.md](README.md) — overview, quickstart, linking frames, keys.
- [docs/SETUP.md](docs/SETUP.md) — full prototype definition, routes, static canvas previews, theming.
- [docs/COMMENTS.md](docs/COMMENTS.md) — comments integration, `Comments` props, markup contract, showcase with comments.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — scripts, repository layout, the no-product-code rule, brand assets and how the banner is rendered.
- [docs/DEPLOY.md](docs/DEPLOY.md) — how the showcase is built and served at paraframe.convex.works.
- [docs/assets/brand/](docs/assets/brand/) — logo files and banner source.
