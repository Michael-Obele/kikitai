/**
 * Mirror a HuggingFace TTS repo into Neon Object Storage and open the bucket
 * to the browser.
 *
 *   bun scripts/sync-tts-models.ts
 *
 * Uploads every file the loader asks for with `Cache-Control: immutable`, so a
 * device fetches each model exactly once — then sets the CORS rule that lets
 * `seedKittenModel()` read it cross-origin. Re-run after any model bump.
 */
import { PutBucketCorsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const HF = 'https://huggingface.co';
const repoId = process.env.TTS_REPO ?? 'KittenML/kitten-tts-nano-0.8';
const bucket = process.env.TTS_S3_BUCKET ?? 'tts-models';
const endpoint = process.env.AWS_ENDPOINT_URL_S3;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

for (const [key, value] of Object.entries({ endpoint, accessKeyId, secretAccessKey })) {
	if (!value) throw new Error(`${key.toUpperCase()} is not set — check .env`);
}

const prefix = `kitten/${repoId.split('/').pop()}`;
const base = `${endpoint}/${bucket}/${prefix}`;

const s3 = new S3Client({
	region: process.env.AWS_REGION ?? 'us-east-2',
	endpoint,
	credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
	// Neon Object Storage is path-style only: bucket.host/key is unsupported.
	forcePathStyle: true
});

const hf = async (file: string) => {
	const res = await fetch(`${HF}/${repoId}/resolve/main/${file}`);
	if (!res.ok) throw new Error(`${res.status} ${HF}/${repoId}/${file}`);
	return Buffer.from(await res.arrayBuffer());
};

// 1. config first — it names the model and voice files.
const config = JSON.parse((await hf('config.json')).toString('utf8'));
const files = [...new Set(['config.json', config.model_file, config.voices ?? 'voices.npz'])];
const sizes: Record<string, number> = {};

for (const file of files) {
	const body = await hf(file);
	sizes[file] = body.length;
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: `${prefix}/${file}`,
			Body: body,
			ContentType: file.endsWith('.json') ? 'application/json' : 'application/octet-stream',
			CacheControl: 'public, max-age=31536000, immutable'
		})
	);
	console.log(`✓ ${prefix}/${file} (${(body.length / 1e6).toFixed(1)} MB)`);
}

// The seeder shards by these sizes — knowing them here means it never has to
// probe the network (HEAD proved flaky from the browser, Content-Range is not
// exposed cross-origin by default).
const manifest = { repo: repoId, files: files.map((name) => ({ name, bytes: sizes[name] })) };
await s3.send(
	new PutObjectCommand({
		Bucket: bucket,
		Key: `${prefix}/manifest.json`,
		Body: JSON.stringify(manifest),
		ContentType: 'application/json',
		CacheControl: 'public, max-age=31536000, immutable'
	})
);
console.log(`✓ ${prefix}/manifest.json`);

// 2. CORS — the model is public content, so any origin may read it.
const origins = (process.env.TTS_ALLOWED_ORIGINS ?? '*')
	.split(',')
	.map((o) => o.trim())
	.filter(Boolean);
await s3.send(
	new PutBucketCorsCommand({
		Bucket: bucket,
		CORSConfiguration: {
			CORSRules: [
				{
					AllowedOrigins: origins,
					AllowedMethods: ['GET', 'HEAD'],
					AllowedHeaders: ['*'],
					ExposeHeaders: [
						'Content-Length',
						'Content-Range',
						'Cache-Control',
						'ETag',
						'Accept-Ranges'
					],
					MaxAgeSeconds: 3000
				}
			]
		}
	})
);
console.log(`✓ CORS: GET/HEAD from ${origins.join(', ')}`);

// 3. Prove the browser path works: anonymous GET + immutable header + speed.
const probe = await fetch(`${base}/config.json`);
console.log(`\nanonymous GET ${base}/config.json → ${probe.status}`);
console.log(`cache-control: ${probe.headers.get('cache-control') ?? '(none)'}`);
console.log(
	`access-control-allow-origin: ${probe.headers.get('access-control-allow-origin') ?? '(none)'}`
);

const modelUrl = `${base}/${config.model_file}`;
const speed = await fetch(modelUrl, { headers: { Range: 'bytes=0-4000000' } }).then(async (r) => {
	const bytes = (await r.arrayBuffer()).byteLength;
	return { status: r.status, bytes, mbps: (bytes / 1e6) * 20 };
});
console.log(
	`ranged GET model → ${speed.status}, ${speed.bytes} bytes ≈ ${speed.mbps.toFixed(1)} MB/s`
);

console.log(`\nPUBLIC_TTS_MODEL_BASE=${base}`);
