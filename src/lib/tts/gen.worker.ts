/**
 * TTS generation, moved off the main thread.
 *
 * Measured before this file existed: one `session.run()` blocked the UI for
 * 9 678 ms (long-task observer on /read), which is why typing and clicking
 * during playback felt randomly frozen. ONNX Runtime loads, the sessions live
 * and `generate()` runs here instead — the main thread only ever moves PCM.
 *
 * Protocol lives in `gen-protocol.ts`; the loading/inference code is shared
 * with the main-thread fallback through `engine-loader.ts`.
 */
import { generateSamples, loadLocal, releaseLocal } from './engine-loader';
import type { GenMessage, GenReply, GenRequest } from './gen-protocol';

let cdnBase = '';
let modelBase: string | undefined;

const post = (reply: GenReply, transfer: Transferable[] = []) =>
	(self as unknown as Worker).postMessage(reply, transfer);

async function handle(message: GenMessage): Promise<void> {
	if (message.op === 'init') {
		// Synchronous, and workers dispatch messages in order — every later
		// request is guaranteed to see the config without a handshake round trip.
		cdnBase = message.cdnBase;
		modelBase = message.modelBase;
		post({ id: message.id, ok: true });
		return;
	}
	if (message.op === 'release') {
		await releaseLocal(message.engine);
		post({ id: message.id, ok: true });
		return;
	}
	if (message.op === 'load') {
		const { stats } = await loadLocal(message.engine, { cdnBase, modelBase });
		post({ id: message.id, ok: true, stats });
		return;
	}
	const { model } = await loadLocal(message.engine, { cdnBase, modelBase });
	const { samples, sampleRate } = await generateSamples(
		model,
		message.text,
		message.voice,
		message.speed
	);
	// A fresh copy: the engine may hand back a view over a buffer it still owns,
	// and transferring would detach it under the model's feet.
	const payload = samples.slice();
	post({ id: message.id, ok: true, samples: payload, sampleRate }, [payload.buffer]);
}

self.addEventListener('message', (event: Event) => {
	const message = (event as MessageEvent<GenRequest>).data as GenMessage;
	void handle(message).catch((error: unknown) => {
		post({
			id: message.id,
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		});
	});
});
