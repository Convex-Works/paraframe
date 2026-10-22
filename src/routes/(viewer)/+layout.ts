import { browser } from '$app/env';
import { commentServer, startDemoComments } from '../../demo/comments.js';
import type { LayoutLoad } from './$types';

// Comments are on unless the demo's service worker cannot run in this browser.
// Prerendering assumes it can, and the browser waits for it before hydrating.
export const load: LayoutLoad = async () => ({
	comments: Boolean(commentServer) || !browser || (await startDemoComments())
});
