import { createPlayer } from '$lib/player.svelte';

/**
 * `/read` plays through its own instance — the app-global store keeps the
 * inbox session untouched while someone is pasting here. localStorage keys
 * stay shared, so the remembered speed/voice behave exactly as before.
 */
export const readPlayer = createPlayer();
