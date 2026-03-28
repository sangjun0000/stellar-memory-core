#!/usr/bin/env node
/**
 * setup.mjs — Pre-downloads the embedding model so first use is instant.
 *
 * Run once after installing:  npm run setup
 *
 * What this does:
 *   1. Downloads Xenova/bge-m3 (~540 MB, quantized) from HuggingFace.
 *   2. Caches it in ~/.cache/huggingface (standard HuggingFace cache location).
 *   3. Shows real-time download progress so you know it's working.
 *
 * After this completes, Stellar Memory starts instantly without any network delay.
 */

const MODEL_NAME = process.env['STELLAR_EMBEDDING_MODEL'] ?? 'Xenova/bge-m3';
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (BGE-M3 is larger)

console.log('Stellar Memory — Model Setup');
console.log('============================');
console.log(`Model: ${MODEL_NAME}`);
console.log('Size:  ~540 MB (quantized int8)');
console.log('Cache: ~/.cache/huggingface');
console.log('');
console.log('Downloading embedding model...');
console.log('(This only happens once — subsequent starts are instant)');
console.log('');

let lastFile = '';
let startTime = Date.now();
let downloadedBytes = 0;
let totalBytes = 0;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function renderProgressBar(percent, width = 30) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
}

function onProgress(info) {
  // info: { status, name, file, progress, loaded, total }
  const { status, file, progress, loaded, total } = info;

  if (status === 'initiate') {
    if (file && file !== lastFile) {
      lastFile = file;
      const fileName = file.split('/').pop() ?? file;
      process.stdout.write(`  Fetching: ${fileName}\n`);
    }
    return;
  }

  if (status === 'download') {
    if (loaded != null) downloadedBytes = loaded;
    if (total != null) totalBytes = total;
    return;
  }

  if (status === 'progress' && progress != null) {
    const pct = Math.min(100, Math.round(progress));
    const bar = renderProgressBar(pct);
    const elapsed = (Date.now() - startTime) / 1000;
    const eta = pct > 0 ? (elapsed / pct) * (100 - pct) : 0;
    const sizeInfo = totalBytes > 0
      ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
      : (downloadedBytes > 0 ? formatBytes(downloadedBytes) : '');
    const etaInfo = eta > 1 ? `  ETA: ${formatTime(eta)}` : '';

    process.stdout.write(
      `\r  ${bar} ${String(pct).padStart(3)}%${sizeInfo ? '  ' + sizeInfo : ''}${etaInfo}   `
    );
    return;
  }

  if (status === 'done') {
    // Clear the progress line and print completion
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
    const fileName = (file ?? lastFile).split('/').pop() ?? '';
    if (fileName) {
      console.log(`  [OK] ${fileName}`);
    }
    return;
  }

  if (status === 'ready') {
    return; // Pipeline ready — handled below
  }
}

// Race setup against a timeout
const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
);

const device = process.env['STELLAR_EMBEDDING_DEVICE'] ?? 'cpu';

const setupPromise = (async () => {
  const { pipeline, env } = await import('@huggingface/transformers');

  // Respect custom cache dir if set, otherwise leave as HuggingFace default (do not set undefined)
  const customCache = process.env['TRANSFORMERS_CACHE'];
  if (customCache) {
    env.cacheDir = customCache;
  }

  const pipe = await pipeline('feature-extraction', MODEL_NAME, {
    dtype: 'q8',
    device,
    progress_callback: onProgress,
  });

  // Run a quick smoke test to make sure the model is functional
  const testOutput = await pipe('test', { pooling: 'mean', normalize: true });
  const dims = testOutput.data.length;

  return dims;
})();

try {
  const dims = await Promise.race([setupPromise, timeoutPromise]);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log(`Setup complete in ${elapsed}s`);
  console.log(`Model output: ${dims}-dimensional embeddings`);
  console.log('');
  console.log('Stellar Memory is ready. Start with:');
  console.log('  npm run dev    (MCP server)');
  console.log('  npm run api    (REST API)');
} catch (err) {
  if (err.message === 'timeout') {
    console.error('');
    console.error('ERROR: Download timed out after 10 minutes.');
    console.error('');
    console.error('Possible causes:');
    console.error('  - Slow internet connection');
    console.error('  - HuggingFace servers unreachable');
    console.error('  - Firewall blocking the download');
    console.error('');
    console.error('To retry:  npm run setup');
    console.error('');
    console.error('If the problem persists, you can set a custom cache directory:');
    console.error('  TRANSFORMERS_CACHE=/path/to/cache npm run setup');
  } else {
    console.error('');
    console.error('ERROR: Model download failed.');
    console.error('');
    console.error('Details:', err.message);
    console.error('');
    console.error('To retry:  npm run setup');
  }
  process.exit(1);
}
