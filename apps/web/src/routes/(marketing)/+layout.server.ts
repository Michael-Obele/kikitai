/**
 * Session flag for the header: signed-in visitors get a Dashboard link instead
 * of Sign in / Connect. Never redirects — this layout wraps public routes.
 */
export async function load({ locals }) {
	return { signedIn: Boolean(locals.user) };
}
