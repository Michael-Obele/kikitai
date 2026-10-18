/** Minimal REST client for apps/web /api/app/v1/*. Bearer injected per request. */
export async function importUrl(webOrigin: string, bearer: string, url: string) {
	const res = await fetch(`${webOrigin}/api/app/v1/import-url`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(bearer ? { Authorization: `Bearer ${bearer}` } : {})
		},
		body: JSON.stringify({ url })
	});
	if (res.status === 401) throw new Error('Unauthorized — sign in again');
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { message?: string } | null;
		throw new Error(body?.message ?? `Import failed (${res.status})`);
	}
	return (await res.json()) as { title: string; text: string; url: string };
}

export function countWords(text: string): number {
	const t = text.trim();
	return t ? t.split(/\s+/).length : 0;
}
