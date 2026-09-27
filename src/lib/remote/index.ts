/** Barrel for every remote function — the client imports from here. */
export { getAuthOptions, getCurrentUser } from './auth.remote';
export {
	connectGmail,
	syncMail,
	getInbox,
	getMessage,
	getDigest,
	getAccountStatus,
	markDigested,
	loadThreadSummary
} from './mail.remote';
export { organizeMail, regenerateSummary, loadDetails, loadListenScript } from './ai.remote';
export { getSettings, saveSettings, saveVoiceChoice, saveVoiceSpeed } from './settings.remote';
export { synthesize } from './audio.remote';
