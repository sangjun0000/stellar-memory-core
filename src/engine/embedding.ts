/**
 * embedding.ts — Local text embedding using Transformers.js
 *
 * Uses the all-MiniLM-L6-v2 model (384 dimensions) for generating dense
 * vector representations of memory text. The model runs entirely in-process
 * via @xenova/transformers — no API key or network call required after the
 * initial model download (~90 MB, cached in ~/.cache/huggingface).
 *
 * Design:
 *   - Singleton pipeline: the model is loaded once and reused.
 *   - generateEmbedding() returns a normalized Float32Array.
 *   - Supports Korean + English mixed text (multilingual tokenizer).
 *   - Input is capped at MAX_CHARS to avoid excessive tokenization.
 */

// @xenova/transformers uses a dynamic import pattern that is CJS-compatible
// when called from Node.js ESM. We import the type for the pipeline function
// and load it lazily.

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const MAX_CHARS = 2000; // roughly 512 tokens for mixed Korean/English text

// Lazily resolved singleton pipeline instance.
// Typed as `unknown` to avoid pulling in the full @xenova/transformers types
// at compile time (the package has non-standard type layouts that vary by version).
let _pipeline: unknown = null;
let _loading: Promise<unknown> | null = null;

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
      console.error('[stellar-memory] Downloading embedding model (~90 MB, first run only)...');
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
 * Load and cache the feature-extraction pipeline.
 * Subsequent calls return the same promise / resolved value.
 */
async function getPipeline(): Promise<unknown> {
  if (_pipeline) return _pipeline;

  if (!_loading) {
    _loading = (async () => {
      // Dynamic import keeps this from failing at require()-time in environments
      // where the model is not yet available (e.g., during unit tests that mock it).
      const { pipeline, env } = await import('@xenova/transformers');

      // Allow the model to be stored in the default HuggingFace cache directory.
      // In CI/test environments TRANSFORMERS_CACHE can be set to override this.
      if (process.env['TRANSFORMERS_CACHE']) {
        env.cacheDir = process.env['TRANSFORMERS_CACHE'];
      }

      const pipe = await pipeline('feature-extraction', MODEL_NAME, {
        quantized: true,          // use the int8-quantized model for faster inference
        progress_callback: _onDownloadProgress,
      });

      _pipeline = pipe;
      return pipe;
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
}

/**
 * Inject a mock pipeline (for unit tests that don't want to download the model).
 * The mock must be callable: mock(text, options) → { data: Float32Array }
 */
export function _setPipelineForTest(mock: unknown): void {
  _pipeline = mock;
  _loading = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a 384-dimensional embedding vector for the given text.
 *
 * The returned Float32Array is L2-normalized so that cosine similarity
 * reduces to a simple dot product.
 *
 * Text preprocessing:
 *   - Trims whitespace
 *   - Caps at MAX_CHARS characters to stay within the tokenizer limit
 *   - Collapses excessive whitespace runs
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const input = preprocessText(text);

  const pipe = await getPipeline();

  // @xenova/transformers returns a Tensor-like object. We use mean pooling
  // (pooling_mode: 'mean') and then L2-normalize to get a unit vector.
  const output = await (pipe as (
    text: string,
    opts: { pooling: string; normalize: boolean }
  ) => Promise<{ data: Float32Array }>)(input, {
    pooling: 'mean',
    normalize: true,
  });

  return new Float32Array(output.data);
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
