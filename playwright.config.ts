import { defineConfig } from '@playwright/test';

/**
 * Guardrail probes — the performance and remount budgets from the UX audit,
 * turned into tests (docs/plans/2026-09-29-remaining-work-plan.md, stream 1).
 *
 * They run against the dev server, because that is the only build where the
 * inline worker needs the `workerIsolationHeaders` middleware (see
 * `vite.config.ts`) and therefore the only build that proves the worker path is
 * actually the one being measured.
 */
const PORT = process.env.GUARDRAIL_PORT ?? '5173';
const baseURL = process.env.GUARDRAIL_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
	testDir: './tests',
	globalSetup: './tests/guardrails/global-setup.ts',
	globalTeardown: './tests/guardrails/global-teardown.ts',

	/** One worker: the probes share one browser profile (and its model cache). */
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	/** First run downloads the 57MB voice model; playback probes then run ~30s. */
	timeout: 300_000,
	expect: { timeout: 20_000 },
	reporter: [['list']],

	use: { baseURL },

	/**
	 * Reuses the dev server that is already running (it must be — the probes
	 * never start, restart or stop the developer's own server). Only when
	 * nothing listens does Playwright start one, e.g. in CI.
	 */
	webServer: {
		command: 'bun run dev',
		url: baseURL,
		reuseExistingServer: true
	}
});
