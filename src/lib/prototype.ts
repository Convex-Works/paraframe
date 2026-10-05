import { error } from '@sveltejs/kit';
import type {
	Frame,
	FrameSize,
	Prototype,
	PrototypeDefinition,
	ResolvedFrame,
	Section
} from './types.js';

export const DEFAULT_SIZE: FrameSize = { width: 1440, height: 900 };

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertId(kind: string, id: string) {
	if (!ID.test(id)) {
		throw new Error(`[paraframe] ${kind} id "${id}" must be lowercase letters, digits and dashes`);
	}
}

/** Validates a prototype definition and indexes its frames. Throws on bad or duplicate ids. */
export function definePrototype(definition: PrototypeDefinition): Prototype {
	const size = { ...DEFAULT_SIZE, ...definition.size };
	const frames: Frame[] = [];
	const byId = new Map<string, Frame>();
	const sectionIds = new Set<string>();

	const sections = definition.sections.map((def) => {
		assertId('Section', def.id);
		if (sectionIds.has(def.id)) throw new Error(`[paraframe] Duplicate section id "${def.id}"`);
		sectionIds.add(def.id);

		const section: Section = { id: def.id, title: def.title, columns: def.columns, frames: [] };
		for (const f of def.frames) {
			assertId('Frame', f.id);
			if (byId.has(f.id)) throw new Error(`[paraframe] Duplicate frame id "${f.id}"`);
			const frame: Frame = {
				id: f.id,
				title: f.title,
				load: f.load,
				props: f.props ?? {},
				size: { ...size, ...f.size },
				section,
				index: frames.length
			};
			frames.push(frame);
			byId.set(f.id, frame);
			section.frames.push(frame);
		}
		return section;
	});

	const flows = (definition.flows ?? []).map((flow) => {
		assertId('Flow', flow.id);
		if (!byId.has(flow.start)) {
			throw new Error(`[paraframe] Flow "${flow.id}" starts on unknown frame "${flow.start}"`);
		}
		return { ...flow };
	});

	return {
		title: definition.title,
		description: definition.description,
		size,
		sections,
		frames,
		flows,
		paths: definition.paths,
		get: (id) => byId.get(id),
		next: (id) => {
			const frame = byId.get(id);
			return frame ? frames[frame.index + 1] : undefined;
		},
		prev: (id) => {
			const frame = byId.get(id);
			return frame && frame.index > 0 ? frames[frame.index - 1] : undefined;
		}
	};
}

/** Prerender entries for a `[frame]` route parameter. */
export function frameEntries(prototype: Prototype): { frame: string }[] {
	return prototype.frames.map((f) => ({ frame: f.id }));
}

/** Imports a frame's component. Use it in the frame route's `load`. Responds 404 for unknown ids. */
export async function resolveFrame(prototype: Prototype, frameId: string): Promise<ResolvedFrame> {
	const frame = prototype.get(frameId);
	if (!frame) error(404, `No frame "${frameId}" in this prototype`);
	const module = await frame.load();
	return { frame, component: module.default };
}
