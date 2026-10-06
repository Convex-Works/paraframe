import { EncryptJWT, jwtDecrypt, type JWTPayload } from 'jose';
import * as oidc from 'openid-client';
import type { Cookies } from '@sveltejs/kit';
import type { AuthUser } from '../auth.js';

export interface ServerOidcConfig {
	authority: string;
	clientId: string;
	clientSecret: string;
	/** Random secret of at least 32 characters, shared across server instances. */
	sessionSecret: string;
	/** Canvas path, also registered as the sign-in and logout redirect. */
	canvasPath?: string;
	scope?: string;
	/** Default: seven days. Token validity is checked separately. */
	sessionMaxAge?: number;
}

export interface AuthRequest {
	request: Request;
	url: URL;
	cookies: Pick<Cookies, 'get' | 'set' | 'delete'>;
}

interface Transaction extends JWTPayload {
	kind: 'transaction';
	state: string;
	nonce: string;
	verifier: string;
	redirectUri: string;
	returnTo: string;
}

interface Session extends JWTPayload {
	kind: 'session';
	user: AuthUser;
	idToken: string;
	refreshToken?: string;
	expiresAt: number;
}

const SESSION_COOKIE = 'pf-session';
const TRANSACTION_COOKIE = 'pf-oidc-transaction';
const noStore = { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' };
const now = () => Math.floor(Date.now() / 1000);

export function safeAuthReturnPath(value: string | null, fallback: string, origin: string): string {
	if (!value?.startsWith('/')) return fallback;
	try {
		const url = new URL(value, origin);
		return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : fallback;
	} catch { return fallback; }
}

function secureUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
		throw new Error('OIDC requires HTTPS outside localhost');
	}
	if (url.username || url.password || url.hash) throw new Error('Invalid OIDC URL');
	return url;
}

function redirect(location: string): Response {
	return new Response(null, { status: 303, headers: { ...noStore, Location: location } });
}

function profile(claims: oidc.IDToken): AuthUser {
	const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
	let picture = text(claims.picture);
	if (picture) { try { picture = secureUrl(picture).href; } catch { picture = undefined; } }
	return {
		sub: claims.sub,
		name: text(claims.name) ?? text(claims.display_name)
			?? text([claims.given_name, claims.family_name].filter((part) => typeof part === 'string').join(' '))
			?? text(claims.preferred_username) ?? text(claims.email) ?? 'Account',
		email: text(claims.email),
		picture
	};
}

/** Server-only OIDC endpoints. Import from paraframe/server, never a browser module. */
export class ServerOidcAuth {
	private config: ServerOidcConfig;
	private discovery?: Promise<oidc.Configuration>;
	private key?: Promise<Uint8Array>;
	private refreshes = new Map<string, { until: number; promise: Promise<Session> }>();
	readonly canvasPath: string;
	readonly authPath: string;
	readonly configured: boolean;

	constructor(config: ServerOidcConfig) {
		this.config = config;
		this.canvasPath = config.canvasPath ?? '/';
		this.authPath = `${this.canvasPath.replace(/\/$/, '')}/auth`;
		this.configured = Boolean(config.clientId && config.clientSecret && config.sessionSecret.length >= 32);
	}

	private configuration(): Promise<oidc.Configuration> {
		if (!this.discovery) {
			const authority = secureUrl(this.config.authority);
			this.discovery = oidc.discovery(authority, this.config.clientId, this.config.clientSecret,
				oidc.ClientSecretPost(this.config.clientSecret), {
					timeout: 15,
					execute: authority.protocol === 'http:'
						? [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks]
						: [oidc.enableNonRepudiationChecks]
				}).catch((error) => { this.discovery = undefined; throw error; });
		}
		return this.discovery;
	}

	private encryptionKey(): Promise<Uint8Array> {
		this.key ??= crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.config.sessionSecret))
			.then((value) => new Uint8Array(value));
		return this.key;
	}

	private cookieOptions(event: AuthRequest, maxAge: number) {
		return { path: this.canvasPath, httpOnly: true, secure: event.url.protocol === 'https:', sameSite: 'lax' as const, maxAge };
	}

	private async seal(payload: JWTPayload): Promise<string> {
		return new EncryptJWT(payload).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
			.setIssuer(this.config.authority).setAudience(this.config.clientId).setIssuedAt()
			.encrypt(await this.encryptionKey());
	}

	private async open<T extends Session | Transaction>(value: string | undefined, kind: T['kind']): Promise<T | null> {
		if (!value || !this.configured) return null;
		try {
			const { payload } = await jwtDecrypt(value, await this.encryptionKey(), {
				issuer: this.config.authority, audience: this.config.clientId,
				keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'],
				requiredClaims: ['exp', 'iat', 'iss', 'aud']
			});
			return payload.kind === kind ? payload as T : null;
		} catch { return null; }
	}

	private async writeSession(event: AuthRequest, session: Session) {
		const value = await this.seal(session);
		if (value.length > 3800) throw new Error('OIDC session exceeds cookie size limit');
		event.cookies.set(SESSION_COOKIE, value, this.cookieOptions(event, session.exp! - now()));
	}

	private sessionFromTokens(tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers, previous?: Session): Session {
		const claims = tokens.claims();
		if (!claims && !previous) throw new Error('Missing ID token');
		if (claims && ((claims.azp !== undefined && claims.azp !== this.config.clientId)
			|| (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== this.config.clientId))) {
			throw new Error('Unexpected authorized party');
		}
		if (claims && previous && claims.sub !== previous.user.sub) throw new Error('Refresh changed the subject');
		if (claims && claims.exp <= now()) throw new Error('Expired ID token');
		const expiresAt = Math.min(now() + (tokens.expires_in ?? 300), claims?.exp ?? Infinity);
		return {
			kind: 'session',
			user: claims ? profile(claims) : previous!.user,
			idToken: tokens.id_token ?? previous!.idToken,
			refreshToken: tokens.refresh_token ?? previous?.refreshToken,
			expiresAt,
			exp: previous?.exp ?? now() + (this.config.sessionMaxAge ?? 7 * 24 * 60 * 60)
		};
	}

	private async renew(session: Session): Promise<Session> {
		// Coalesce simultaneous requests using the same rotating refresh token.
		for (const [key, item] of this.refreshes) if (item.until < Date.now()) this.refreshes.delete(key);
		const key = session.refreshToken!;
		let item = this.refreshes.get(key);
		if (!item) {
			const promise = (async () => this.sessionFromTokens(
				await oidc.refreshTokenGrant(await this.configuration(), key), session))();
			item = { promise, until: Date.now() + 30_000 };
			this.refreshes.set(key, item);
		}
		return item.promise;
	}

	/** The signed-in user, renewing tokens when needed; null when signed out. For the host's own endpoints. */
	async user(event: AuthRequest): Promise<AuthUser | null> {
		return (await this.current(event)).session?.user ?? null;
	}

	private async session(event: AuthRequest): Promise<Response> {
		const { session, error } = await this.current(event);
		return Response.json({ user: session?.user ?? null, configured: this.configured, error,
			expiresAt: session?.expiresAt ?? null }, { headers: noStore });
	}

	private async current(event: AuthRequest): Promise<{ session: Session | null; error: string | null }> {
		let session = await this.open<Session>(event.cookies.get(SESSION_COOKIE), 'session');
		let error: string | null = null;
		if (session && session.expiresAt <= now() + 60) {
			try {
				if (session.refreshToken) {
					session = await this.renew(session);
					await this.writeSession(event, session);
				} else if (session.expiresAt <= now()) session = null;
			} catch {
				// Fail closed if the provider rejects or cannot verify the renewed identity.
				session = null;
				error = 'Your session could not be renewed. Sign in again.';
			}
		}
		if (!session) event.cookies.delete(SESSION_COOKIE, { path: this.canvasPath });
		return { session, error };
	}

	private async login(event: AuthRequest): Promise<Response> {
		secureUrl(event.url.origin);
		const config = await this.configuration();
		const verifier = oidc.randomPKCECodeVerifier();
		const transaction: Transaction = {
			kind: 'transaction', state: oidc.randomState(), nonce: oidc.randomNonce(), verifier,
			redirectUri: new URL(this.canvasPath, event.url.origin).href,
			returnTo: safeAuthReturnPath(event.url.searchParams.get('returnTo'), this.canvasPath, event.url.origin),
			exp: now() + 600
		};
		const destination = oidc.buildAuthorizationUrl(config, {
			redirect_uri: transaction.redirectUri, response_type: 'code',
			scope: this.config.scope ?? 'openid profile email offline_access',
			state: transaction.state, nonce: transaction.nonce,
			code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256'
		});
		event.cookies.set(TRANSACTION_COOKIE, await this.seal(transaction), this.cookieOptions(event, 600));
		return redirect(destination.href);
	}

	private async callback(event: AuthRequest): Promise<Response> {
		const transaction = await this.open<Transaction>(event.cookies.get(TRANSACTION_COOKIE), 'transaction');
		event.cookies.delete(TRANSACTION_COOKIE, { path: this.canvasPath });
		try {
			if (!transaction || transaction.redirectUri !== new URL(this.canvasPath, event.url.origin).href) {
				throw new Error('Missing or expired sign-in transaction');
			}
			const tokens = await oidc.authorizationCodeGrant(await this.configuration(), event.url, {
				pkceCodeVerifier: transaction.verifier, expectedState: transaction.state,
				expectedNonce: transaction.nonce, idTokenExpected: true
			});
			await this.writeSession(event, this.sessionFromTokens(tokens));
			return redirect(safeAuthReturnPath(transaction.returnTo, this.canvasPath, event.url.origin));
		} catch (error) {
			event.cookies.delete(SESSION_COOKIE, { path: this.canvasPath });
			const cancelled = error instanceof oidc.AuthorizationResponseError && error.error === 'access_denied';
			return redirect(`${this.canvasPath}?auth_error=${cancelled ? 'cancelled' : 'signin_failed'}`);
		}
	}

	private async logout(event: AuthRequest): Promise<Response> {
		if (event.request.headers.get('origin') !== event.url.origin) {
			return new Response('Invalid request origin', { status: 403, headers: noStore });
		}
		const session = await this.open<Session>(event.cookies.get(SESSION_COOKIE), 'session');
		event.cookies.delete(SESSION_COOKIE, { path: this.canvasPath });
		event.cookies.delete(TRANSACTION_COOKIE, { path: this.canvasPath });
		try {
			if (session) {
				const config = await this.configuration();
				if (config.serverMetadata().end_session_endpoint) {
					return redirect(oidc.buildEndSessionUrl(config, {
						id_token_hint: session.idToken,
						post_logout_redirect_uri: new URL(this.canvasPath, event.url.origin).href
					}).href);
				}
			}
			return redirect(this.canvasPath);
		} catch { return redirect(`${this.canvasPath}?auth_error=logout_failed`); }
	}

	/** Returns undefined for requests that belong to the host app. */
	async handle(event: AuthRequest): Promise<Response | undefined> {
		const path = event.url.pathname;
		if (path === this.canvasPath && (event.url.searchParams.has('code') || event.url.searchParams.has('error'))) {
			return this.callback(event);
		}
		if (!path.startsWith(`${this.authPath}/`)) return undefined;
		if (path === `${this.authPath}/session` && event.request.method === 'GET') return this.session(event);
		if (!this.configured) return new Response('Sign-in is not configured', { status: 503, headers: noStore });
		try {
			if (path === `${this.authPath}/login` && event.request.method === 'GET') return await this.login(event);
			if (path === `${this.authPath}/logout` && event.request.method === 'POST') return await this.logout(event);
		} catch { return redirect(`${this.canvasPath}?auth_error=signin_failed`); }
		return new Response('Method or endpoint not supported', { status: 405, headers: noStore });
	}
}
