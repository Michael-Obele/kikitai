/**
 * `primeOnnxRuntime()` points `wasmPaths` at a pinned `onnxruntime-web` build,
 * but `kitten-tts-js@0.1.2` depends on `onnxruntime-web@^1.20.0` and jsDelivr
 * resolves that range itself. If the two ever disagree, session creation dies
 * with "no available backend found".
 *
 *   bun scripts/check-ort-pin.ts     (exit 1 on drift)
 *
 * Keep in sync with ORT_MODULE / ORT_DIST in src/lib/tts/index.ts.
 */
const PIN = '1.24.2';
const KITTEN = 'kitten-tts-js@0.1.2';

const bundle = await (await fetch(`https://cdn.jsdelivr.net/npm/${KITTEN}/+esm`)).text();
const resolved = [
	...new Set([...bundle.matchAll(/onnxruntime-web@(\d+\.\d+\.\d+)/g)].map((m) => m[1]))
];

if (resolved.length === 0) {
	console.error(`no onnxruntime-web reference in ${KITTEN} — the loader changed, review the pin`);
	process.exit(1);
}
const drifted = resolved.filter((version) => version !== PIN);
if (drifted.length > 0) {
	console.error(
		`onnxruntime-web drift: ${KITTEN} resolves [${resolved.join(', ')}] but we pin ${PIN}.\n` +
			`Update ORT_MODULE / ORT_DIST in src/lib/tts/index.ts and PIN here.`
	);
	process.exit(1);
}
console.log(`onnxruntime-web ${PIN} — ${KITTEN} agrees`);
