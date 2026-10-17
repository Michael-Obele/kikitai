import { error } from '@sveltejs/kit';
import type { AiConfig } from '$lib/server/ai';
import type { Session } from '$lib/server/auth';
import { requireUser } from '$lib/server/session';
import { getAiConfig } from '$lib/server/settings';

/**
 * The precondition every AI-backed remote function shares: a signed-in user
 * who also has an AI endpoint configured.
 *
 * Both failures raised the same 400 as the call sites did inline, and the order
 * of the checks is unchanged — this only gives one rule one home instead of
 * five, so a change to the message or to what counts as "configured" cannot
 * drift between them. Callers that only need the user (Gmail sync, settings)
 * still call `requireUser` directly.
 */
export async function requireAiUser(): Promise<{ user: Session['user']; aiConfig: AiConfig }> {
	const { user } = await requireUser();
	const aiConfig = await getAiConfig(user.id);
	if (!aiConfig) error(400, 'Set an AI endpoint (base URL + model) in Settings first.');
	return { user, aiConfig };
}
