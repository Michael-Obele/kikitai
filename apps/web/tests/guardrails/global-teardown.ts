import { closeContext } from './harness';
import { cleanProbe, withDb } from './db';

/**
 * Delete the probe rows again so a run leaves the app database exactly as it
 * found it, and close the suite's single browser (the per-spec
 * `afterAll(closeContext)` calls are no-ops — see `harness.ts`). Skipped only
 * when a run is killed outright — the next setup re-seeds the same ids, so a
 * leftover never breaks anything.
 */
export default async function globalTeardown(): Promise<void> {
	process.env.GUARDRAILS_TEARDOWN = '1';
	// The browser must close whatever the database does — a network blip here
	// would otherwise strand it, and a leftover row is harmless: the next setup
	// upserts the same ids.
	await closeContext();
	try {
		await withDb((db) => cleanProbe(db));
	} catch (error) {
		console.warn(`[guardrails] could not clean probe rows: ${String(error)}`);
	}
}
