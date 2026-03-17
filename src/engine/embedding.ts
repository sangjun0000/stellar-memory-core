/**
 * embedding.ts — Local text embedding using Transformers.js
 *
 * Uses the BGE-M3 model (1024 dimensions) for generating dense vector
 * representations of memory text. The model runs entirely in-process via
 * @huggingface/transformers — no API key or network call required after the
 * initial model download (~540 MB, cached in ~/.cache/huggingface).
 *
 * Design:
 *   - Lazy-loaded singleton pipeline (stays loaded for the process lifetime).
 *   - CPU users: zero VRAM, ~500MB RAM. GPU users: ~6 GB VRAM (opted in).
 *   - generateEmbedding() returns a normalized Float32Array.
 *   - Supports Korean + English mixed text (multilingual tokenizer).
 *   - Input is capped at MAX_CHARS to avoid excessive tokenization.
 *
 * GPU notes (DirectML on Windows):
 *   DirectML does NOT support int8-quantized (q8) models — the operators
 *   DynamicQuantizeLinear and MatMulInteger fall back to CPU, making the
 *   GPU 0% utilized. When device is 'dml', we use fp32 dtype instead so
 *   all compute nodes actually run on the GPU. If DirectML initialization
 *   fails, we fall back to CPU automatically.
 */

const MODEL_NAME = 'Xenova/bge-m3';
const MAX_CHARS = 4000; // roughly 512 tokens for mixed Korean/English text

/** Output dimensionality of BGE-M3 embeddings. Exported for vec.ts and tests. */
export const EMBEDDING_DIM = 1024;

// Lazily resolved singleton pipeline instance.
// GPU users opted in to permanent VRAM usage, so the pipeline stays loaded.
// CPU users have no VRAM cost, so it also stays loaded.
let _pipeline: unknown = null;
let _loading: Promise<unknown> | null = null;

/** The device actually used after initialization (may differ from config if fallback occurred). */
let _activeDevice = 'cpu';

// ── Progress tracking ────────────────────────────────────────────────────────

let _downloadStartTime = 0;
let _lastProgressPct = -1;
let _currentFile = '';
let _loggedFiles = new Set<string>();

function _formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function _formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

interface ProgressInfo {
  status: string;
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

function _onDownloadProgress(info: ProgressInfo): void {
  const { status, file, progress, loaded, total } = info;
  const fileName = (file ?? '').split('/').pop() ?? '';

  if (status === 'initiate') {
    if (_downloadStartTime === 0) {
      _downloadStartTime = Date.now();
      console.error('[stellar-memory] Downloading embedding model (~540 MB, first run only)...');
      console.error('[stellar-memory] This will be cached for future sessions.');
    }
    // Reset per-file tracking when a new file starts
    if (fileName && fileName !== _currentFile) {
      _currentFile = fileName;
      _lastProgressPct = -1;
    }
  }

  if (status === 'progress' && progress != null && fileName) {
    // Only show detailed progress for the main model file (onnx)
    const isModelFile = fileName.endsWith('.onnx');
    if (!isModelFile) return;

    const pct = Math.min(100, Math.round(progress));
    if (pct > _lastProgressPct + 10 || (pct === 100 && _lastProgressPct < 100)) {
      _lastProgressPct = pct;
      const elapsed = (Date.now() - _downloadStartTime) / 1000;
      const eta = pct > 0 ? (elapsed / pct) * (100 - pct) : 0;
      const sizeInfo = loaded != null && total != null
        ? `  ${_formatBytes(loaded)} / ${_formatBytes(total)}`
        : '';
      const etaInfo = eta > 1 ? `  ETA: ${_formatTime(eta)}` : '';
      console.error(`[stellar-memory] Downloading [${fileName}]: ${pct}%${sizeInfo}${etaInfo}`);
    }
  }

  if (status === 'done' && fileName && !_loggedFiles.has(fileName)) {
    _loggedFiles.add(fileName);
  }

  if (status === 'ready') {
    const elapsed = _downloadStartTime > 0
      ? ` in ${((Date.now() - _downloadStartTime) / 1000).toFixed(1)}s`
      : '';
    console.error(`[stellar-memory] Embedding model ready${elapsed}`);
    _downloadStartTime = 0;
    _lastProgressPct = -1;
    _currentFile = '';
    _loggedFiles = new Set();
  }
}

/**
 * Select the optimal dtype for the given device.
 *
 * DirectML cannot execute int8 quantization operators (DynamicQuantizeLinear,
 * MatMulInteger). When those operators are present in the ONNX graph, ORT
 * reassigns them to CPU — so the GPU shows 0% utilization despite being
 * "enabled." Using fp32 (or fp16) ensures all nodes run on the GPU.
 *
 * CUDA supports int8 operators natively, so q8 is fine there.
 * CPU always supports q8 and benefits from the smaller model size.
 */
type DtypeOption = 'fp32' | 'fp16' | 'q8' | 'q4' | 'int8' | 'uint8' | 'bnb4' | 'q4f16' | 'auto';

function selectDtype(device: string): DtypeOption {
  switch (device) {
    case 'dml':   return 'fp32'; // DirectML: must use float, not quantized
    case 'cuda':  return 'q8';   // CUDA handles int8 natively
    default:      return 'q8';   // CPU: q8 is smaller and fast enough
  }
}

/**
 * Load and cache the feature-extraction pipeline.
 * Subsequent calls return the same promise / resolved value.
 *
 * If the requested GPU device fails (e.g., DirectML on a system without a
 * compatible GPU), we automatically fall back to CPU and log a warning.
 */
async function getPipeline(): Promise<unknown> {
  if (_pipeline) return _pipeline;

  if (!_loading) {
    _loading = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');

      if (process.env['TRANSFORMERS_CACHE']) {
        env.cacheDir = process.env['TRANSFORMERS_CACHE'];
      }

      const { getConfig } = await import('../utils/config.js');
      const configDevice = getConfig().embeddingDevice;
      const modelName = process.env['STELLAR_EMBEDDING_MODEL'] ?? MODEL_NAME;

      // Try the configured device first; fall back to CPU on failure.
      const devicesToTry: string[] =
        configDevice !== 'cpu' ? [configDevice, 'cpu'] : ['cpu'];

      for (const device of devicesToTry) {
        const dtype = selectDtype(device);
        try {
          console.error(
            `[stellar-memory] Loading embedding model (device=${device}, dtype=${dtype})...`
          );

          const pipe = await pipeline('feature-extraction', modelName, {
            dtype,
            device: device as 'cpu' | 'cuda' | 'dml',
            progress_callback: _onDownloadProgress,
          });

          _activeDevice = device;
          _pipeline = pipe;

          if (device !== 'cpu') {
            console.error(`[stellar-memory] GPU acceleration active (${device})`);
          }

          return pipe;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[stellar-memory] Failed to initialize on ${device}: ${msg}`
          );
          if (device !== 'cpu') {
            console.error('[stellar-memory] Falling back to CPU...');
          }
        }
      }

      // Should never reach here (CPU should always work), but just in case
      throw new Error('Failed to initialize embedding pipeline on any device');
    })();
  }

  return _loading;
}

/**
 * Reset the singleton pipeline (for testing purposes).
 * Allows tests to inject a mock pipeline via _setPipelineForTest().
 */
export function _resetPipeline(): void {
  _pipeline = null;
  _loading = null;
  _queryCacheSize = null;
}

/**
 * Inject a mock pipeline (for unit tests that don't want to download the model).
 * The mock must be callable: mock(text, options) => { data: Float32Array }
 */
export function _setPipelineForTest(mock: unknown): void {
  _pipeline = mock;
  _loading = null;
}

/** Returns the device the embedding pipeline is actually running on. */
export function getActiveDevice(): string {
  return _activeDevice;
}

// ---------------------------------------------------------------------------
// Query embedding cache (LRU, avoids regenerating for repeated/similar queries)
// ---------------------------------------------------------------------------

// Resolved lazily on first call so the config singleton is already initialised
// (config.json has been read). We cache the resolved size to avoid repeated lookups.
let _queryCacheSize: number | null = null;

async function getQueryCacheSize(): Promise<number> {
  if (_queryCacheSize !== null) return _queryCacheSize;
  const { getConfig } = await import('../utils/config.js');
  _queryCacheSize = getConfig().queryCacheSize ?? 128;
  return _queryCacheSize;
}

const _queryCache = new Map<string, Float32Array>();

function getCachedEmbedding(key: string): Float32Array | undefined {
  const cached = _queryCache.get(key);
  if (cached) {
    // Move to end (most recently used)
    _queryCache.delete(key);
    _queryCache.set(key, cached);
  }
  return cached;
}

async function setCachedEmbedding(key: string, embedding: Float32Array): Promise<void> {
  const maxSize = await getQueryCacheSize();
  if (_queryCache.size >= maxSize) {
    // Evict oldest (first entry)
    const oldest = _queryCache.keys().next().value;
    if (oldest !== undefined) _queryCache.delete(oldest);
  }
  _queryCache.set(key, embedding);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a 1024-dimensional embedding vector for the given text.
 *
 * The returned Float32Array is L2-normalized so that cosine similarity
 * reduces to a simple dot product.
 *
 * Includes an LRU cache (32 entries) so repeated queries skip inference.
 *
 * Text preprocessing:
 *   - Trims whitespace
 *   - Caps at MAX_CHARS characters to stay within the tokenizer limit
 *   - Collapses excessive whitespace runs
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const input = preprocessText(text);

  // Check LRU cache first (exact match on preprocessed text)
  const cached = getCachedEmbedding(input);
  if (cached) return cached;

  const pipe = await getPipeline();

  // @huggingface/transformers returns a Tensor-like object. We use mean pooling
  // (pooling_mode: 'mean') and then L2-normalize to get a unit vector.
  const output = await (pipe as (
    text: string,
    opts: { pooling: string; normalize: boolean }
  ) => Promise<{ data: Float32Array; dispose?: () => void }>)(input, {
    pooling: 'mean',
    normalize: true,
  });

  // Copy data out before disposing the tensor to release ONNX Runtime buffers
  const embedding = new Float32Array(output.data);

  // Dispose the output tensor if the method exists (frees native memory)
  if (typeof output.dispose === 'function') {
    try { output.dispose(); } catch { /* ignore disposal errors */ }
  }

  await setCachedEmbedding(input, embedding);
  return embedding;
}

/**
 * Generate an embedding using a CPU-only pipeline.
 * Used by re-embedding queue to avoid GPU TDR issues during batch processing.
 * Creates a separate CPU pipeline instance (not the singleton GPU one).
 */
let _cpuPipeline: unknown = null;
let _cpuLoading: Promise<unknown> | null = null;

async function getCpuPipeline(): Promise<unknown> {
  if (_cpuPipeline) return _cpuPipeline;
  if (!_cpuLoading) {
    _cpuLoading = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      if (process.env['TRANSFORMERS_CACHE']) {
        env.cacheDir = process.env['TRANSFORMERS_CACHE'];
      }
      const modelName = process.env['STELLAR_EMBEDDING_MODEL'] ?? MODEL_NAME;
      console.error('[stellar-memory] Loading CPU embedding pipeline for re-embedding (q8)...');
      const pipe = await pipeline('feature-extraction', modelName, {
        dtype: 'q8',
        device: 'cpu',
        progress_callback: _onDownloadProgress,
      });
      console.error('[stellar-memory] CPU embedding pipeline ready');
      _cpuPipeline = pipe;
      return pipe;
    })();
  }
  return _cpuLoading;
}

export async function generateEmbeddingCpu(text: string): Promise<Float32Array> {
  const input = preprocessText(text);
  const pipe = await getCpuPipeline();
  const output = await (pipe as (
    text: string,
    opts: { pooling: string; normalize: boolean }
  ) => Promise<{ data: Float32Array; dispose?: () => void }>)(input, {
    pooling: 'mean',
    normalize: true,
  });
  const embedding = new Float32Array(output.data);
  if (typeof output.dispose === 'function') {
    try { output.dispose(); } catch { /* ignore */ }
  }
  return embedding;
}

/**
 * Preprocess text before tokenization:
 *   1. Trim
 *   2. Collapse internal whitespace runs to a single space
 *   3. Truncate to MAX_CHARS
 */
export function preprocessText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_CHARS);
}
