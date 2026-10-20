// The showcase loads @convex-works/sign-in only when comments are on (see
// hooks.server.ts). It is a private package linked from ../sign-in, which a
// clone may not have, so declare the little the showcase uses of it here.
declare module '@convex-works/sign-in' {
	export interface User {
		sub: string;
		name: string;
		email?: string;
		picture?: string;
	}
}

declare module '@convex-works/sign-in/server' {
	import type { Handle } from '@sveltejs/kit';
	export function createSignIn(options: { devLogin?: boolean }): { sveltekit(): Handle };
}
