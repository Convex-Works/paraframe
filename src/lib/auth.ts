import { getContext, setContext } from 'svelte';

/** Same-origin server endpoints, supplied by the host app. */
export interface AuthPaths {
	session: string;
	login: string;
	logout: string;
}

export interface AuthUser {
	sub: string;
	name: string;
	email?: string;
	picture?: string;
}

export interface AuthState {
	user: AuthUser | null;
	loading: boolean;
	busy: boolean;
	error: string | null;
	configured: boolean;
}

/** The current viewer session. Tokens stay private to the OIDC client. */
export interface ParaframeAuth extends AuthState {
	signIn(): Promise<void>;
	signOut(): Promise<void>;
	clearError(): void;
}

const KEY = Symbol('paraframe.auth');

export function setAuth(auth: ParaframeAuth) {
	setContext(KEY, auth);
}

/** Undefined when the host has not opted into authentication. */
export function useAuth(): ParaframeAuth | undefined {
	return getContext<ParaframeAuth | undefined>(KEY);
}
