// The showcase's server, with comments only when `VITE_COMMENTS_SERVER` is set:
// it signs viewers in (with any name; there is no identity provider here) and
// passes comment requests on to that server's `demo` space.
import { sequence } from '@sveltejs/kit/hooks';
import { createSignIn } from '@convex-works/sign-in/server';
import { commentsProxy } from 'visual-comments/server';
import type { Handle } from '@sveltejs/kit/hooks';

const server = import.meta.env.VITE_COMMENTS_SERVER as string | undefined;

export const handle: Handle = server
	? sequence(
		createSignIn({ devLogin: true }).sveltekit(),
		commentsProxy({ server, space: 'demo', secret: 'development-only-secret-for-the-demo-space' }).sveltekit()
	)
	: ({ event, resolve }) => resolve(event);
