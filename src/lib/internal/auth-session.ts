import type { AuthPaths, AuthState } from '../auth.js';

/** The browser sees user details only. OIDC tokens and secrets stay on the server. */
export class AuthSession {
	state: AuthState = { user: null, loading: true, busy: false, error: null, configured: false };
	private paths: AuthPaths;
	private notify: (state: AuthState) => void;
	private disposed = false;
	private timer?: ReturnType<typeof setTimeout>;
	private request?: AbortController;

	constructor(paths: AuthPaths, notify: (state: AuthState) => void) {
		this.paths = paths;
		this.notify = notify;
	}

	private update(next: Partial<AuthState>) {
		if (this.disposed) return;
		this.state = { ...this.state, ...next };
		this.notify(this.state);
	}

	async refresh() {
		if (this.disposed || this.state.busy) return;
		this.request?.abort();
		const request = new AbortController();
		this.request = request;
		clearTimeout(this.timer);
		try {
			const response = await fetch(this.paths.session, { credentials: 'same-origin', cache: 'no-store', signal: request.signal });
			if (!response.ok) throw new Error('Session unavailable');
			const result = await response.json();
			if (this.disposed || request.signal.aborted) return;
			this.update({ user: result.user, configured: result.configured, error: result.error ?? this.state.error, loading: false });
			if (result.user) this.timer = setTimeout(() => { void this.refresh(); },
				Math.max(1000, Math.min(60_000, result.expiresAt * 1000 - Date.now() + 1000)));
		} catch {
			if (!request.signal.aborted) this.update({ user: null, loading: false, error: 'Could not check your session. Please try again.' });
		}
	}

	async start() {
		const url = new URL(window.location.href);
		const error = url.searchParams.get('auth_error');
		if (error) {
			this.update({ error: error === 'cancelled' ? 'Sign-in was cancelled. You can try again.'
				: error === 'logout_failed' ? 'You are signed out here, but the identity provider could not be reached.'
				: 'Could not verify your sign-in. Please try again.' });
		}
		window.addEventListener('focus', this.onFocus);
		window.addEventListener('pageshow', this.onPageShow);
		await this.refresh();
	}

	private onFocus = () => { void this.refresh(); };
	private onPageShow = (event: PageTransitionEvent) => {
		if (event.persisted) { this.update({ busy: false }); void this.refresh(); }
	};

	async signIn() {
		if (this.state.loading || this.state.busy) return;
		if (!this.state.configured) {
			this.update({ error: 'Sign-in has not been configured for this prototype.' });
			return;
		}
		this.update({ busy: true, error: null });
		const target = new URL(this.paths.login, window.location.origin);
		target.searchParams.set('returnTo', `${location.pathname}${location.search}${location.hash}`);
		window.location.assign(target.href);
	}

	async signOut() {
		if (this.state.loading || this.state.busy) return;
		this.request?.abort();
		clearTimeout(this.timer);
		this.update({ user: null, busy: true, error: null });
		const form = document.createElement('form');
		form.method = 'POST';
		form.action = this.paths.logout;
		form.hidden = true;
		document.body.appendChild(form);
		form.submit();
	}

	clearError() { this.update({ error: null }); }

	dispose() {
		this.disposed = true;
		this.request?.abort();
		clearTimeout(this.timer);
		window.removeEventListener('focus', this.onFocus);
		window.removeEventListener('pageshow', this.onPageShow);
	}
}
