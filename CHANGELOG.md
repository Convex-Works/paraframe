# Changelog

All notable changes to paraframe are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and paraframe
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Forgejo CI runs check, test, package and build on every pull request and
  on main.

## [0.1.0] - 2026-10-20

First release.

### Added

- `Canvas`: every frame of a prototype, in sections, on a board you can pan
  and zoom. It has keyboard navigation (⇧1 fit all, ⇧0 100%, F or ⇧2 fit the
  selection, ← → select, Enter play). Frames where a flow starts carry a tag
  that plays the flow, and you can double-click a frame to play it.
- `Player`: one frame at a time, scaled to the window. ← → step through
  frames, named flows give starting points, and R restarts the flow that is
  playing.
- `FrameHost`: each frame is a real Svelte component, rendered in its own
  iframe at its own size, with its own styles, isolated from the chrome.
  `definePrototype`, `frameEntries` and `resolveFrame` define and prerender
  frames. Several frames can share one component with different `size` and
  `props`.
- Frame links: `FrameLink`, `useFrameNav()` hotspots on any element, and
  navigation from code. Clicking where there is no link highlights the
  links.
- Static canvas previews: an optional `preview` image per frame at overview
  scale. Frames switch to live iframes as you zoom in or hover, through an
  idle-gated load queue that starts one frame at a time.
- Live canvas frames receive hover, so tooltips and hover states work on the
  canvas.
- Chrome styled as frosted islands of pill-shaped tools, themed through
  `--pf-*` custom properties in `paraframe/styles.css`.
- Optional comments through [visual-comments](https://github.com/Convex-Works/visual-comments),
  from `paraframe/comments`. Pinned threads sit on elements inside frames
  and follow them as frames scroll or change. Press C for comment mode. The
  comments go through the prototype's own server, which also signs viewers
  in. visual-comments is an optional peer dependency.
- A showcase prototype (`pnpm showcase`), Vitest unit tests, and README,
  setup, comments and development docs.
- MIT license.

[Unreleased]: https://github.com/Convex-Works/paraframe/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Convex-Works/paraframe/releases/tag/v0.1.0
