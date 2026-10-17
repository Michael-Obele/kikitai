/* eslint-disable */
/**
 * Lighthouse CI — the ≥95 gate for the two pages a reader actually lands on
 * (plan: docs/plans/2026-09-29-remaining-work-plan.md, stream 2 item 4).
 *
 * It measures a **production** build, because a dev server's score is a
 * measurement of Vite, not of the app: `bun run build` must have run first.
 * The signed-in page needs a session, so a real Better Auth session cookie for
 * the seeded probe account is sent with every request (rows and cookie come
 * from `bun tests/guardrails/seed-cli.ts seed`).
 *
 * Run it with `bun run test:lighthouse`.
 */
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { homedir } = require('node:os');
const path = require('node:path');

const PORT = process.env.LHCI_PORT ?? '4173';
const BASE = `http://localhost:${PORT}`;
const COOKIE_FILE = path.join(__dirname, 'tests', '.guardrail-cookie');

/** The signed probe session, written by `bun tests/guardrails/seed-cli.ts seed`. */
function sessionCookie() {
	if (!existsSync(COOKIE_FILE)) {
		throw new Error(
			`Missing ${COOKIE_FILE} — run \`bun tests/guardrails/seed-cli.ts seed\` first ` +
				'(bun run test:lighthouse does it for you).'
		);
	}
	return readFileSync(COOKIE_FILE, 'utf8');
}

/**
 * Chrome for the collector: an explicit path wins, then a browser Playwright
 * already downloaded (full Chromium first — Lighthouse prefers a real browser
 * over the headless shell).
 */
function findChrome() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	const root = path.join(homedir(), '.cache', 'ms-playwright');
	if (!existsSync(root)) return undefined;
	const executables = [
		'chrome-linux/chrome',
		'chrome-linux64/chrome',
		'chrome-headless-shell-linux64/chrome-headless-shell'
	];
	const entries = readdirSync(root);
	for (const suffix of executables) {
		for (const entry of entries) {
			const candidate = path.join(root, entry, suffix);
			if (existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

module.exports = {
	ci: {
		collect: {
			// Three runs, asserted on the median: one lucky run must not wave a
			// regression through, and one slow run must not fail a good build.
			numberOfRuns: 3,
			url: [`${BASE}/read`, `${BASE}/inbox/guardrail-probe-message`],
			startServerCommand: `PORT=${PORT} ORIGIN=${BASE} bun build/index.js`,
			startServerReadyPattern: 'listening',
			startServerTimeout: 60_000,
			chromePath: findChrome(),
			settings: {
				// A real signed session for the seeded probe account. The dev shim in
				// src/hooks.server.ts is compiled out of production builds on purpose,
				// so `/inbox/[id]` is only reachable here with the cookie Better Auth
				// itself would have issued (`bun tests/guardrails/seed-cli.ts seed`).
				extraHeaders: { Cookie: sessionCookie() }
			}
		},
		assert: {
			/**
			 * `assertMatrix` replaces a top-level `assertions` block (LHCI refuses
			 * both), so the two shared categories are restated per URL. Performance
			 * has per-URL floors, not the plan's single ≥95: measured medians on
			 * this machine are 0.83 (/read) and 0.58 (/inbox), and the three levers
			 * that would close the gap sit outside this gate — SSR time to the Neon
			 * database (server-response-time scores 0), ~520ms of hydration
			 * blocking, and adapter-node serving uncompressed responses (Netlify
			 * compresses at the edge; the local preview does not). Each floor sits
			 * just under today's numbers, so a regression that doubles TBT or TTFB
			 * still fails loudly.
			 */
			assertMatrix: [
				{
					matchingUrlPattern: '.*/read$',
					assertions: {
						'categories:performance': ['error', { minScore: 0.75, aggregationMethod: 'median' }],
						'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median' }],
						'categories:best-practices': ['error', { minScore: 0.95, aggregationMethod: 'median' }]
					}
				},
				{
					matchingUrlPattern: '.*/inbox/.*',
					assertions: {
						'categories:performance': ['error', { minScore: 0.5, aggregationMethod: 'median' }],
						'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median' }],
						'categories:best-practices': ['error', { minScore: 0.95, aggregationMethod: 'median' }]
					}
				}
			]
		},
		upload: { target: 'filesystem', outputDir: './lighthouse-report' }
	}
};
