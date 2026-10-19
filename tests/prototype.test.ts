import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SIZE,
	definePrototype,
	frameEntries,
	resolveFrame
} from '../src/lib/prototype.js';
import type { FrameComponent, FrameDefinition, PrototypeDefinition } from '../src/lib/types.js';

const Component = (() => {}) as unknown as FrameComponent;

function def(id: string, extra: Partial<FrameDefinition> = {}): FrameDefinition {
	return { id, title: id, load: async () => ({ default: Component }), ...extra };
}

function prototype(overrides: Partial<PrototypeDefinition> = {}): PrototypeDefinition {
	return {
		title: 'Demo',
		paths: { canvas: () => '/', play: (id) => `/play/${id}`, frame: (id) => `/frame/${id}` },
		sections: [
			{ id: 'onboarding', title: 'Onboarding', frames: [def('welcome'), def('sign-up')] },
			{ id: 'app', title: 'App', columns: 2, frames: [def('home'), def('settings')] }
		],
		...overrides
	};
}

describe('definePrototype', () => {
	it('indexes frames in reading order across sections', () => {
		const p = definePrototype(prototype());
		expect(p.frames.map((f) => [f.id, f.index, f.section.id])).toEqual([
			['welcome', 0, 'onboarding'],
			['sign-up', 1, 'onboarding'],
			['home', 2, 'app'],
			['settings', 3, 'app']
		]);
		expect(p.sections.map((s) => s.frames.map((f) => f.id))).toEqual([
			['welcome', 'sign-up'],
			['home', 'settings']
		]);
		expect(p.sections[1].columns).toBe(2);
	});

	it('applies the default size, the prototype size and per-frame overrides', () => {
		expect(definePrototype(prototype()).size).toEqual(DEFAULT_SIZE);

		const p = definePrototype(
			prototype({
				size: { width: 390 },
				sections: [
					{
						id: 'mobile',
						title: 'Mobile',
						frames: [def('feed'), def('sheet', { size: { height: 400 } })]
					}
				]
			})
		);
		expect(p.size).toEqual({ width: 390, height: DEFAULT_SIZE.height });
		expect(p.get('feed')?.size).toEqual({ width: 390, height: DEFAULT_SIZE.height });
		expect(p.get('sheet')?.size).toEqual({ width: 390, height: 400 });
	});

	it('defaults frame props to an empty object and keeps given props', () => {
		const p = definePrototype(
			prototype({
				sections: [
					{ id: 's', title: 'S', frames: [def('a'), def('b', { props: { tab: 'billing' } })] }
				]
			})
		);
		expect(p.get('a')?.props).toEqual({});
		expect(p.get('b')?.props).toEqual({ tab: 'billing' });
	});

	it('looks up frames and steps through them across section boundaries', () => {
		const p = definePrototype(prototype());
		expect(p.get('home')?.title).toBe('home');
		expect(p.get('missing')).toBeUndefined();
		expect(p.next('sign-up')?.id).toBe('home');
		expect(p.prev('home')?.id).toBe('sign-up');
		expect(p.next('settings')).toBeUndefined();
		expect(p.prev('welcome')).toBeUndefined();
		expect(p.next('missing')).toBeUndefined();
		expect(p.prev('missing')).toBeUndefined();
	});

	it('keeps flows that start on a known frame', () => {
		const p = definePrototype(prototype({ flows: [{ id: 'signup', title: 'Sign up', start: 'sign-up' }] }));
		expect(p.flows).toEqual([{ id: 'signup', title: 'Sign up', start: 'sign-up' }]);
		expect(definePrototype(prototype()).flows).toEqual([]);
	});

	it.each(['Home', 'home_page', 'home--page', '-home', 'home-', '', 'hôme'])(
		'rejects the frame id %j',
		(id) => {
			expect(() =>
				definePrototype(prototype({ sections: [{ id: 's', title: 'S', frames: [def(id)] }] }))
			).toThrow(/Frame id .* must be lowercase letters, digits and dashes/);
		}
	);

	it('rejects bad section and flow ids', () => {
		expect(() =>
			definePrototype(prototype({ sections: [{ id: 'My Section', title: 'S', frames: [] }] }))
		).toThrow(/Section id "My Section"/);
		expect(() =>
			definePrototype(prototype({ flows: [{ id: 'Main', title: 'Main', start: 'welcome' }] }))
		).toThrow(/Flow id "Main"/);
	});

	it('rejects duplicate section ids', () => {
		expect(() =>
			definePrototype(
				prototype({
					sections: [
						{ id: 'a', title: 'A', frames: [def('one')] },
						{ id: 'a', title: 'A again', frames: [def('two')] }
					]
				})
			)
		).toThrow('Duplicate section id "a"');
	});

	it('rejects duplicate frame ids, including across sections', () => {
		expect(() =>
			definePrototype(
				prototype({
					sections: [
						{ id: 'a', title: 'A', frames: [def('home')] },
						{ id: 'b', title: 'B', frames: [def('home')] }
					]
				})
			)
		).toThrow('Duplicate frame id "home"');
	});

	it('rejects a flow that starts on an unknown frame', () => {
		expect(() =>
			definePrototype(prototype({ flows: [{ id: 'main', title: 'Main', start: 'nowhere' }] }))
		).toThrow('Flow "main" starts on unknown frame "nowhere"');
	});
});

describe('frameEntries', () => {
	it('lists every frame id for prerendering', () => {
		expect(frameEntries(definePrototype(prototype()))).toEqual([
			{ frame: 'welcome' },
			{ frame: 'sign-up' },
			{ frame: 'home' },
			{ frame: 'settings' }
		]);
	});
});

describe('resolveFrame', () => {
	it('loads the frame component', async () => {
		const p = definePrototype(prototype());
		const resolved = await resolveFrame(p, 'home');
		expect(resolved.frame).toBe(p.get('home'));
		expect(resolved.component).toBe(Component);
	});

	it('responds 404 for an unknown frame', async () => {
		const p = definePrototype(prototype());
		const failure = await resolveFrame(p, 'missing').catch((e: unknown) => e);
		expect(isHttpError(failure, 404)).toBe(true);
	});
});
