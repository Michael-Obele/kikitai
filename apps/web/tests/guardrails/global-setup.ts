import { execSync } from 'node:child_process';
import { seedProbe, withDb } from './db';
import { PROFILE_DIR } from './harness';

/**
 * Seed the probe account before any test runs (idempotent).
 */
export default async function globalSetup(): Promise<void> {
	// A run that was killed mid-flight can leave a browser holding this profile;
	// the next launch against it dies within seconds ("Target page … has been
	// closed"). Only processes bound to *our* profile are touched — never another
	// session's browser, which runs from a temp directory.
	try {
		execSync(`pkill -f "user-data-dir=${PROFILE_DIR}"`, { stdio: 'ignore' });
	} catch {
		// exit code 1 = no matches, which is the normal case
	}
	await withDb((db) => seedProbe(db));
}
