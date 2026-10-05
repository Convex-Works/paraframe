// Per-viewer conveniences only. Storage can be unavailable (private windows, blocked
// site data), so every access is guarded and failures fall back to the default.

export function readStored<T>(store: 'local' | 'session', key: string, fallback: T): T {
	try {
		const raw = (store === 'local' ? localStorage : sessionStorage).getItem(key);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

export function writeStored(store: 'local' | 'session', key: string, value: unknown) {
	try {
		(store === 'local' ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
	} catch {
		// Not persisting is fine.
	}
}

export function storageKey(prototypeTitle: string, name: string) {
	return `paraframe:${prototypeTitle}:${name}`;
}
