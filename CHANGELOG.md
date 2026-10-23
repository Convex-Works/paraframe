# Changelog

All notable changes to paraframe are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and paraframe
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `Canvas` and `Player` set the page title: the prototype's title on the
  canvas, and "Frame – Prototype" in the player. Tabs, history and
  bookmarks name the page, and SvelteKit's route announcer reads the
  frame's title on each frame change instead of "untitled page". This overrides a `<title>`
  an app sets in its viewer layout, because the component's is deeper.
- `Canvas` tells screen readers which frame is selected. A visually hidden
  status region says "Frame, Section. Enter to play." when ← → or a click
  change the selection, the selected frame's label button has
  `aria-pressed="true"`, and the Play button is named "Play from Frame"
  while a frame is selected.

### Changed

- `Canvas`: the board is a labelled `role="region"` instead of
  `role="application"`. It never took focus itself and its keys are handled
  on the window, so the role only risked taking screen readers out of
  browse mode.

### Fixed

- `Player`: when the frame that has keyboard focus is replaced, for example
  after activating a `FrameLink` from the keyboard, focus moves to the new
  frame instead of falling back to the page, so Tab carries on inside it.
- Typing a comment no longer triggers the canvas and player shortcuts. Keys
  typed in visual-comments' composer, which sits in a shadow root, reached
  them as if typed on the page and never reached the comment: in the player
  R restarted the flow and the arrows changed frames, and on the canvas F,
  = and - moved the view.

## [0.2.0] - 2026-10-21

### Added

- Forgejo CI runs check, test, package and build on every pull request and
  on main.
- Frames take an optional `path`, where the screen lives in the product (for
  example `/{account}/projects`). The player shows it beside the frame's
  title, and the canvas does once a frame is wide enough on screen.

### Changed

- `paraframe/styles.css` is plain, pre-compiled CSS (about 19 kB, 5 kB
  gzipped). Apps no longer need Tailwind: `tailwindcss` is no longer a peer
  dependency, and `@tailwindcss/vite` is not needed to use paraframe. Apps
  that ran paraframe's `styles.css` through their own Tailwind build now get
  compiled CSS, and can drop Tailwind if only paraframe needed it.
- The README quickstart works as written in a new `sv create` app: install
  command, a frame component and the full code of every route file. The
  setup docs match and add a theming example.

### Fixed

- `Canvas`: Enter on a focused control (a button, link or menu item)
  activates that control instead of playing the selected frame.
- Menus have real menu semantics: `role="menu"`, and the checked flow,
  frame or scale is a `menuitemradio` with `aria-checked`. Arrow keys and
  Home/End move between items, Escape or Tab closes the menu, and focus
  returns to the trigger.
- The chrome's islands are frosted in Chromium browsers and Firefox, not only
  in Safari. The compiled CSS kept only `-webkit-backdrop-filter` on
  `.pf-island`.

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

[Unreleased]: https://github.com/Convex-Works/paraframe/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Convex-Works/paraframe/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Convex-Works/paraframe/releases/tag/v0.1.0
