/**
 * embedding.test.ts — Embedding generation unit tests
 *
 * These tests mock the @huggingface/transformers pipeline so that no model
 * download is required during CI. The mock returns deterministic float32
 * vectors of the correct dimension.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _resetPipeline, _setPipelineForTest, generateEmbedding, preprocessText, EMBEDDING_DIM } from '../src/engine/embedding.js';

// ---------------------------------------------------------------------------
// Mock pipeline
// ---------------------------------------------------------------------------

/**
 * Create a deterministic mock pipeline function.
 * Returns a float32 vector whose first element encodes a hash of the input
 * so we can verify different texts produce different embeddings.
 */
function makeMockPipeline() {
  return async (text: string, _opts: { pooling: string; normalize: boolean }) => {
    const data = new Float32Array(EMBEDDING_DIM);
    // Simple deterministic hash: sum of char codes mod 1
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash + text.charCodeAt(i)) % 1000;
    data[0] = hash / 1000;
    data[1] = 0.5;
    // Normalize to unit vector
    let norm = 0;
    for (const v of data) norm += v * v;
    norm = Math.sqrt(norm);
    for (let i = 0; i < data.length; i++) data[i] /= norm;
    return { data };
  };
}

beforeEach(() => {
  _resetPipeline();
  _setPipelineForTest(makeMockPipeline());
});

afterEach(() => {
  _resetPipeline();
});

// ---------------------------------------------------------------------------
// generateEmbedding
// ---------------------------------------------------------------------------

describe('generateEmbedding', () => {
  it('returns a Float32Array of the correct dimension', async () => {
    const embedding = await generateEmbedding('test input');
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(EMBEDDING_DIM);
  });

  it('returns different embeddings for different inputs', async () => {
    const e1 = await generateEmbedding('authentication token');
    const e2 = await generateEmbedding('database migration');
    // At minimum the first element should differ
    expect(e1[0]).not.toBeCloseTo(e2[0], 10);
  });

  it('returns the same embedding for the same input (deterministic mock)', async () => {
    const e1 = await generateEmbedding('hello world');
    const e2 = await generateEmbedding('hello world');
    expect(Array.from(e1)).toEqual(Array.from(e2));
  });

  it('handles empty string without throwing', async () => {
    await expect(generateEmbedding('')).resolves.toBeInstanceOf(Float32Array);
  });

  it('handles very long text by truncating before model call', async () => {
    const long = 'x '.repeat(5000);
    await expect(generateEmbedding(long)).resolves.toBeInstanceOf(Float32Array);
  });

  it('handles Korean text', async () => {
    const embedding = await generateEmbedding('인증 토큰 관리 시스템');
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(EMBEDDING_DIM);
  });
});

// ---------------------------------------------------------------------------
// preprocessText
// ---------------------------------------------------------------------------

describe('preprocessText', () => {
  it('trims leading and trailing whitespace', () => {
    expect(preprocessText('  hello  ')).toBe('hello');
  });

  it('collapses internal whitespace runs', () => {
    expect(preprocessText('hello   world\t\nfoo')).toBe('hello world foo');
  });

  it('truncates to 4000 characters', () => {
    const long = 'a'.repeat(5000);
    expect(preprocessText(long).length).toBe(4000);
  });

  it('preserves Korean characters', () => {
    const result = preprocessText('안녕하세요 세계');
    expect(result).toBe('안녕하세요 세계');
  });

  it('returns empty string for empty input', () => {
    expect(preprocessText('')).toBe('');
  });
});
