/** Turn a thrown remote error into something a toast can show. */
export function errorMessage(error: unknown): string {
	if (error && typeof error === 'object') {
		const body = (error as { body?: { message?: string; code?: number } }).body;
		if (body?.message) return body.message;
	}
	if (error instanceof Error) return error.message;
	return 'Something went wrong.';
}
