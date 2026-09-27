import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
	if (!locals.user) redirect(303, '/login');

	return {
		user: {
			id: locals.user.id,
			name: locals.user.name,
			email: locals.user.email,
			image: locals.user.image ?? null
		}
	};
}
