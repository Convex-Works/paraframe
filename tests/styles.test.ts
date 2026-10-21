import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Compiles src/styles.css the way `pnpm css` does, so the test sees what ships in dist/styles.css.
let dir: string;
let css: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), 'paraframe-styles-'));
	const out = join(dir, 'styles.css');
	execFileSync('node_modules/.bin/tailwindcss', ['-i', 'src/styles.css', '-o', out, '--minify'], {
		stdio: 'pipe'
	});
	css = readFileSync(out, 'utf8');
}, 30_000);

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** The declaration blocks of rules whose selector is exactly `selector`. */
function blocks(selector: string) {
	return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.filter(([, s]) => s.trim() === selector)
		.map(([, , body]) => body);
}

describe('compiled styles.css', () => {
	it('frosts the islands in every browser, not only WebKit', () => {
		const [island] = blocks('.pf-island');
		expect(island).toMatch(/(^|;)backdrop-filter:blur\(5px\)/);
	});

	// The minifier keeps only the last of two declarations it treats as the same property,
	// so a hand-written -webkit- line after the standard one drops the standard one.
	it('keeps the unprefixed property wherever it emits -webkit-backdrop-filter', () => {
		const rules = [...css.matchAll(/\{([^{}]*)\}/g)].map(([, body]) => body);
		const prefixed = rules.filter((body) => /(^|;)-webkit-backdrop-filter:/.test(body));
		expect(prefixed.length).toBeGreaterThan(0);
		for (const body of prefixed) expect(body).toMatch(/(^|;)backdrop-filter:/);
	});
});
