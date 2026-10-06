const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['minute', 60_000],
	['hour', 3_600_000],
	['day', 86_400_000]
];

/** "just now", "5 minutes ago", "yesterday", then a date. */
export function ago(time: number, now: number): string {
	const elapsed = Math.max(0, now - time);
	if (elapsed < 60_000) return 'just now';
	if (elapsed < 7 * 86_400_000) {
		const [unit, size] = UNITS.findLast(([, size]) => elapsed >= size)!;
		return relative.format(-Math.floor(elapsed / size), unit);
	}
	const date = new Date(time);
	return date.toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric'
	});
}

export function fullDate(time: number): string {
	return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
