/** Barrel for every remote function — the client imports from here. */
export { getAuthOptions, getCurrentUser } from './auth.remote';
export {
	connectGmail,
	syncMail,
	getInbox,
	getMessage,
	getDigest,
	getAccountStatus,
	markDigested
} from './mail.remote';
export { organizeMail, regenerateSummary } from './ai.remote';
export { getSettings, saveSettings, saveVoiceSpeed } from './settings.remote';
export { synthesize } from './audio.remote';
