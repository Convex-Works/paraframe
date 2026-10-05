import { frameEntries, resolveFrame } from '#lib';
import { prototype } from '../../../demo/prototype.js';
import type { PageLoad } from './$types';

export const entries = () => frameEntries(prototype);

export const load: PageLoad = async ({ params }) => ({
	resolved: await resolveFrame(prototype, params.frame)
});
