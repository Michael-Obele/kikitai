import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

const ALGO = 'aes-256-gcm';
const PREFIX = 'v1';

function key(): Buffer {
	const secret = env.AUTH_TOKEN_SECRET || env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error('AUTH_TOKEN_SECRET (or BETTER_AUTH_SECRET) is not set');
	return createHash('sha256').update(secret).digest();
}

/** Encrypt a secret for storage (OAuth tokens, AI key). Output: `v1:iv:tag:ct`. */
export function encrypt(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv(ALGO, key(), iv);
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return [
		PREFIX,
		iv.toString('base64url'),
		cipher.getAuthTag().toString('base64url'),
		ct.toString('base64url')
	].join(':');
}

/** Decrypt a value produced by {@link encrypt}. Throws on tampering. */
export function decrypt(stored: string): string {
	const [prefix, iv, tag, ct] = stored.split(':');
	if (prefix !== PREFIX) throw new Error('Unknown token format');
	const decipher = createDecipheriv(ALGO, key(), Buffer.from(iv!, 'base64url'));
	decipher.setAuthTag(Buffer.from(tag!, 'base64url'));
	return Buffer.concat([decipher.update(Buffer.from(ct!, 'base64url')), decipher.final()]).toString(
		'utf8'
	);
}

/** True when a stored value looks encrypted (avoids double-encrypting). */
export const isEncrypted = (value: string) => value.startsWith(`${PREFIX}:`);
