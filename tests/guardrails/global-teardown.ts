import { cleanProbe, withDb } from './db';

/**
 * Delete the probe rows again so a run leaves the app database exactly as it
 * found it. Skipped only when a run is killed outright — the next setup
 * re-seeds the same ids, so a leftover never breaks anything.
 */
export default async function globalTeardown(): Promise<void> {
	await withDb((db) => cleanProbe(db));
}
