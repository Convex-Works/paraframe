// The showcase's comments. With `VITE_COMMENTS_SERVER` set they come from that
// server through src/hooks.server.ts. Without it, as at paraframe.convex.works,
// there is no server: the service worker in src/service-worker stands in for
// one and keeps each visitor's comments in their own browser.

/** The comment server the showcase's own server passes requests on to, if any. */
export const commentServer = import.meta.env.VITE_COMMENTS_SERVER as string | undefined;

/** Where the service worker answers comment requests and the sign-in. */
export const demoComments = { endpoint: '/_demo/comments', auth: '/_demo/auth' };

/** How long the first visit waits for the service worker before showing the showcase without comments. */
const START_MS = 3000;

/**
 * Starts the service worker and resolves once it controls this page, so the
 * comments' first request reaches it. False when it cannot: no service
 * workers (an insecure origin, some private windows) or no start in time.
 */
export async function startDemoComments(): Promise<boolean> {
	if (!('serviceWorker' in navigator)) return false;
	const workers = navigator.serviceWorker;
	try {
		// Built, the worker is a plain script; in development Vite serves it as a module.
		await workers.register('/service-worker.js', { type: import.meta.env.DEV ? 'module' : 'classic' });
	} catch {
		return false;
	}
	if (workers.controller) return true;
	// A first visit or a hard reload: ask the worker to take over this page.
	const controlled = new Promise<boolean>((resolve) => {
		workers.addEventListener('controllerchange', () => resolve(true), { once: true });
		setTimeout(() => resolve(Boolean(workers.controller)), START_MS);
	});
	void workers.ready.then((registration) => registration.active?.postMessage('claim'));
	return controlled;
}
