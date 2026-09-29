import { seedProbe, withDb } from './db';

/** Seed the probe account before any test runs (idempotent). */
export default async function globalSetup(): Promise<void> {
	await withDb((db) => seedProbe(db));
}
