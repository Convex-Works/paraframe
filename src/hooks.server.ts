// The showcase's server, with comments only when `VITE_COMMENTS_SERVER` is set:
// it signs viewers in (with any name; there is no identity provider here) and
// passes comment requests on to that server's `demo` space. Without it the
// showcase is fully static and needs neither import, so they load only here.
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit/hooks';

const server = import.meta.env.VITE_COMMENTS_SERVER as string | undefined;

async function commentsHandle(server: string): Promise<Handle> {
	const [{ createSignIn }, { commentsProxy }] = await Promise.all([
		import('@convex-works/sign-in/server'),
		import('visual-comments/server')
	]);
	return sequence(
		createSignIn({ devLogin: true }).sveltekit(),
		commentsProxy({ server, space: 'demo', secret: 'development-only-secret-for-the-demo-space' }).sveltekit()
	);
}

export const handle: Handle = server
	? await commentsHandle(server)
	: ({ event, resolve }) => resolve(event);
