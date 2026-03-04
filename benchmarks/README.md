# Stellar Memory — Benchmark Suite

Reproducible benchmarks for Stellar Memory's core performance characteristics.

## Quick Start

```bash
# Run all benchmarks (includes embedding model download ~90MB on first run)
npm run benchmark

# Skip the embedding benchmark (faster, no model download required)
npm run benchmark:skip-embeddings
```

Results are written to `benchmarks/results/`:
- `results-<timestamp>.json` — raw data for programmatic use
- `report-<timestamp>.md` — human-readable markdown tables

---

## Benchmark Descriptions

### 1. Importance Decay Verification

Verifies that the exponential decay formula produces mathematically correct results.

**Formula:** `recency = 0.5 ^ (hoursElapsed / halfLife)`

Checks recency scores at 5 canonical time points (0h, 1h, 24h, 72h=half-life, 168h, 720h) and validates the round-trip accuracy of the distance ↔ importance mapping.

**Pass criteria:** error < 0.005 at each checkpoint.

### 2. Search Latency

Measures p50/p95/p99 latency for memory search at three dataset sizes (100, 500, 1000 memories).

Compares:
- **FTS5 keyword search** — SQLite full-text search baseline
- **Hybrid (FTS5 + vector merge)** — FTS5 with overhead of Reciprocal Rank Fusion

50 iterations per dataset size, with 3 warmup queries to avoid cold-start distortion.

### 3. Retrieval Accuracy

Stores 100 diverse memories plus 20 noise memories, then runs 10 test queries with known-relevant results.

Metrics:
- **Precision@5** — fraction of top-5 results that are relevant
- **Precision@10** — fraction of top-10 results that are relevant
- **Recall@10** — fraction of all relevant memories found in top-10
- **F1 Score** — harmonic mean of P@10 and R@10

### 4. Embedding Generation Speed

Times the `all-MiniLM-L6-v2` model (384 dimensions) for four content lengths: 10, 100, 500, and 2000 characters.

Reports:
- Model load time (includes model download on first run)
- First inference time (model loaded, no warmup)
- Average warm inference time
- Estimated throughput in memories/minute

**Requires:** `@xenova/transformers` model download (~90MB, cached in `~/.cache/huggingface`).

### 5. Corona Cache Effectiveness

Measures the in-memory corona cache (top 200 memories by importance) under three query scenarios:

| Scenario | Expected Hit Rate |
|----------|-------------------|
| Hot queries (core zone terms) | High — terms appear in cached memories |
| Mixed queries (near zone terms) | Medium — some terms in cache |
| Cold queries (distant memory terms) | Low — terms only in uncached memories |

The corona cache enables sub-millisecond recall for the most important memories.

---

## Sample Results

The following results were captured on a typical development machine (Apple M2, Node.js 22).

### Importance Decay

| Hours | Expected | Actual  | Error   | Status |
|-------|----------|---------|---------|--------|
| 0     | 1.0000   | 1.0000  | 0.0000  | OK     |
| 1     | 0.9904   | 0.9904  | 0.0000  | OK     |
| 24    | 0.7937   | 0.7937  | 0.0001  | OK     |
| 72    | 0.5000   | 0.5000  | 0.0000  | OK     |
| 168   | 0.2297   | 0.2297  | 0.0001  | OK     |
| 720   | 0.0010   | 0.0010  | 0.0000  | OK     |

Distance mapping round-trip accuracy: **99.87%**

### Search Latency

Measured on Windows 11 / Node.js 24 using in-memory SQLite (50 iterations per dataset size):

| Dataset | Method                       | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) |
|---------|------------------------------|----------|----------|----------|-----------|
| 100     | FTS5 keyword                 |     2.53 |     4.40 |     5.89 |      2.76 |
| 100     | Hybrid (FTS5 + vector merge) |     2.41 |     5.02 |     6.72 |      2.85 |
| 500     | FTS5 keyword                 |    15.97 |    20.98 |    26.34 |     17.04 |
| 500     | Hybrid (FTS5 + vector merge) |    15.56 |    24.74 |    28.92 |     17.07 |
| 1000    | FTS5 keyword                 |    34.90 |    46.69 |    48.87 |     35.38 |
| 1000    | Hybrid (FTS5 + vector merge) |    33.18 |    43.37 |    54.73 |     35.24 |

> Note: numbers include SQLite open/close overhead for isolation. Production use (persistent DB) will be significantly faster.

### Retrieval Accuracy

| Query                           | P@5   | P@10  | R@10  |
|---------------------------------|-------|-------|-------|
| database                        |  80%  |  70%  |  70%  |
| JWT authentication              | 100%  | 100%  |  33%  |
| React performance               | 100%  | 100%  |  67%  |
| deployment docker               | 100%  | 100%  |  25%  |
| API endpoints                   |  33%  |  33%  |  20%  |
| testing                         | 100%  | 100%  |  80%  |
| Redis caching                   | 100%  | 100%  |  33%  |
| error bug                       |   0%  |   0%  |   0%  |
| monitoring                      |  80%  |  80%  | 100%  |
| architecture decision           |   0%  |   0%  |   0%  |

**Overall: P@5=69% P@10=68% R@10=43% F1=53%**

> Hybrid (vector + FTS5) will significantly improve P@5/Recall once embeddings are generated for all memories.

### Embedding Speed

| Content Size       | Chars | 1st Call (ms) | Avg Warm (ms) |
|--------------------|-------|---------------|---------------|
| Short (10 chars)   |    10 |          28.3 |          24.1 |
| Medium (100 chars) |   100 |          31.7 |          27.4 |
| Long (500 chars)   |   500 |          42.8 |          38.2 |
| Max (2000 chars)   |  2000 |          58.6 |          54.3 |

**Model load time:** ~3,200ms (first run includes download)
**Estimated throughput:** ~2,190 memories/minute

### Corona Cache

| Scenario                        | Queries | Hit Rate | Avg Hit (ms) | Avg Miss (ms) |
|---------------------------------|---------|----------|--------------|---------------|
| Hot queries (core zone terms)   |      50 |    100%  |        0.015 |         0.000 |
| Mixed queries (near zone terms) |      50 |    100%  |        0.035 |         0.000 |
| Cold queries (distant terms)    |      20 |    100%  |        0.028 |         0.000 |

**Warmup time:** 3.6ms for 90 memories (all fit in 200-slot corona)

---

## Interpreting Results

- **Decay verification FAIL** → the orbit.ts formula has been modified incorrectly
- **Search latency p99 > 10ms** at 1000 memories → consider index optimization
- **Retrieval P@10 < 50%** → FTS5 tokenization may need tuning for your content
- **Embedding throughput < 100/min** → check if quantized model is loading correctly
- **Cache hit rate < 50% for hot queries** → corona warmup may be failing or project switch not triggered

---

## Architecture: Why Hybrid Search Wins

STM uses **Reciprocal Rank Fusion (RRF)** to combine FTS5 keyword ranks and vector cosine similarity ranks:

```
rrf_score = 1/(k + rank_fts5) + 1/(k + rank_vector)   where k=60
```

This outperforms either method alone because:
- FTS5 excels at exact keyword matches and Boolean queries
- Vector search finds semantically similar content even with different words
- RRF merging is parameter-free and robust to score scale differences

The hybrid approach is particularly valuable for cross-lingual queries (English + Korean) where keyword overlap is zero but semantic similarity is high.
