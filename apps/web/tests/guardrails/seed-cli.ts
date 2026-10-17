import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { COOKIE_FILE, cleanProbe, probeSessionCookie, seedProbe, withDb } from './db';

/**
 * Seed or remove the probe rows from outside Playwright — Lighthouse needs a
 * signed-in page to exist before it measures one, and it is not a test runner.
 *
 *   bun tests/guardrails/seed-cli.ts seed
 *   bun tests/guardrails/seed-cli.ts clean
 *
 * `seed` also writes the signed session cookie Lighthouse must send, because
 * Lighthouse is not a browser session we can drive — it can only send headers.
 */
const action = process.argv[2];

if (action === 'seed') {
	await withDb((db) => seedProbe(db));
	writeFileSync(COOKIE_FILE, probeSessionCookie(), 'utf8');
	console.log('guardrail probe rows seeded (session cookie written for Lighthouse)');
} else if (action === 'clean') {
	await withDb((db) => cleanProbe(db));
	if (existsSync(COOKIE_FILE)) rmSync(COOKIE_FILE);
	console.log('guardrail probe rows removed');
} else {
	console.error('usage: bun tests/guardrails/seed-cli.ts <seed|clean>');
	process.exit(1);
}
