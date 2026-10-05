import type { Component } from 'svelte';

// Frames can take any props; `FrameDefinition.props` supplies them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FrameComponent = Component<any>;

/** A frame's viewport in CSS pixels. */
export interface FrameSize {
	width: number;
	height: number;
}

export interface FrameDefinition {
	/** URL-safe identifier: lowercase letters, digits and single dashes. */
	id: string;
	title: string;
	/** Imports the frame's component, e.g. `() => import('./Overview.svelte')`. */
	load: () => Promise<{ default: FrameComponent }>;
	/** Props passed to the component, so one component can back several frames. */
	props?: Record<string, unknown>;
	/** Overrides the prototype's default size. */
	size?: Partial<FrameSize>;
}

export interface SectionDefinition {
	id: string;
	title: string;
	frames: FrameDefinition[];
	/** Wrap frames onto a new canvas row after this many. Default: one row. */
	columns?: number;
}

/** A named starting point for clicking through the prototype. */
export interface FlowDefinition {
	id: string;
	title: string;
	/** Id of the frame the flow starts on. */
	start: string;
}

/**
 * Where the host app mounts paraframe's three views. Build these with
 * `resolve()` from `$app/paths` so base paths are respected, e.g.
 * `play: (frame) => resolve(`play/${frame}`)`.
 */
export interface PrototypePaths {
	/** The canvas with every frame. */
	canvas: () => string;
	/** The player, showing one frame. */
	play: (frameId: string) => string;
	/** A frame rendered on its own, without paraframe's chrome. Loaded inside iframes. */
	frame: (frameId: string) => string;
}

export interface PrototypeDefinition {
	title: string;
	description?: string;
	/** Default frame size. Default: 1440 × 900. */
	size?: Partial<FrameSize>;
	sections: SectionDefinition[];
	flows?: FlowDefinition[];
	paths: PrototypePaths;
}

export interface Frame {
	id: string;
	title: string;
	load: FrameDefinition['load'];
	props: Record<string, unknown>;
	size: FrameSize;
	section: Section;
	/** Position in reading order across all sections. */
	index: number;
}

export interface Section {
	id: string;
	title: string;
	columns: number | undefined;
	frames: Frame[];
}

export interface Flow {
	id: string;
	title: string;
	start: string;
}

export interface Prototype {
	title: string;
	description: string | undefined;
	size: FrameSize;
	sections: Section[];
	/** Every frame, in reading order. */
	frames: Frame[];
	flows: Flow[];
	paths: PrototypePaths;
	get(frameId: string): Frame | undefined;
	/** The frame after this one in reading order, if any. */
	next(frameId: string): Frame | undefined;
	/** The frame before this one in reading order, if any. */
	prev(frameId: string): Frame | undefined;
}

/** A frame with its component imported, ready to render. */
export interface ResolvedFrame {
	frame: Frame;
	component: FrameComponent;
}
