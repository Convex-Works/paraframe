import { getContext, setContext } from 'svelte';
import type { Attachment } from 'svelte/attachments';

/** Navigation between frames, available to any component inside a frame. */
export interface FrameNav {
	/** Id of the frame being shown. */
	readonly current: string;
	/** URL that opens a frame in the player. */
	href(frameId: string): string;
	/** Shows another frame. */
	go(frameId: string): void;
	/**
	 * Turns any element into a link to another frame, e.g. a table row:
	 * `<tr {@attach nav.hotspot('detail')}>`.
	 */
	hotspot(frameId: string): Attachment<HTMLElement>;
}

const KEY = Symbol('paraframe.nav');

const detached: FrameNav = {
	current: '',
	href: () => '#',
	go: () => {},
	hotspot: () => () => {}
};

export function setFrameNav(nav: FrameNav) {
	setContext(KEY, nav);
}

/** Returns frame navigation. Outside a frame host, links do nothing. */
export function useFrameNav(): FrameNav {
	return getContext<FrameNav | undefined>(KEY) ?? detached;
}
