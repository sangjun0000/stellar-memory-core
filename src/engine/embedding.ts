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
const MAX_CHARS  = 2000; // roughly 512 tokens for mixed Korean/English text

// Lazily resolved singleton pipeline instance.
// Typed as `unknown` to avoid pulling in the full @xenova/transformers types
// at compile time (the package has non-standard type layouts that vary by version).
let _pipeline: unknown = null;
let _loading: Promise<unknown> | null = null;

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
      env.cacheDir = process.env['TRANSFORMERS_CACHE'] ?? undefined;

      const pipe = await pipeline('feature-extraction', MODEL_NAME, {
        quantized: true, // use the int8-quantized model for faster inference
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
  _loading  = null;
}

/**
 * Inject a mock pipeline (for unit tests that don't want to download the model).
 * The mock must be callable: mock(text, options) → { data: Float32Array }
 */
export function _setPipelineForTest(mock: unknown): void {
  _pipeline = mock;
  _loading  = null;
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
