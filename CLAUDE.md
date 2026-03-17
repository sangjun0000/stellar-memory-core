# CLAUDE.md — Stellar Memory (STM)

## Project Overview

Stellar Memory is a persistent AI memory system using **celestial mechanics as metaphor** — important memories orbit close to the Sun, forgotten ones drift to the outer reaches. Operates as:

1. **MCP Server** — Claude Code/Desktop integration (stdio transport)
2. **REST API** — Hono on port 21547
3. **Web Dashboard** — React + D3.js orbital visualization
4. **Electron Desktop App** — Windows NSIS installer

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ (required for `node:sqlite`) |
| Language | TypeScript 5.9, ESM throughout |
| Database | `node:sqlite` (built-in) + FTS5 + sqlite-vec |
| Embeddings | `@huggingface/transformers` (BGE-M3, 1024d, local, CPU/GPU) |
| MCP | `@modelcontextprotocol/sdk` 1.27+ |
| API | Hono + `@hono/node-server` |
| Web | React 19 + D3 7 + Three.js + Tailwind CSS + Vite |
| 3D | `@react-three/fiber` + `@react-three/drei` |
| Desktop | Electron 40 + electron-builder |
| Testing | Vitest (root: 2.1.9, web: 3.2.4) |
| Validation | Zod |

## Project Structure

```
src/
├── engine/          # Core: orbit, gravity, planet, sun, corona, embedding, quality, analytics, etc.
├── storage/         # database.ts, queries.ts, vec.ts (sqlite-vec)
├── mcp/             # server.ts + tools/ (memory-tools, ingestion-tools, daemon-tool)
├── api/             # server.ts + routes/ (13 route files)
├── scanner/         # local/ (filesystem, git, parsers/) + metadata-scanner
├── service/         # daemon.ts, scheduler.ts
├── utils/           # config.ts, logger.ts, tokenizer.ts, time.ts
└── index.ts         # Entry point (stdio MCP transport)

web/src/
├── api/client.ts    # API client
├── components/      # SolarSystem, Layout, SearchBar, MemoryDetail, DataSources, etc.
├── i18n/            # context.tsx, en.ts, ko.ts (React Context 기반, 외부 라이브러리 없음)
└── test/            # App.test.tsx, SearchBar.test.tsx

tests/               # 22 test files, 340 tests
electron/            # main.ts (Electron main process)
```

## Common Commands

```bash
# Development
npm run dev              # MCP server (stdio, watch mode)
npm run api              # REST API on :21547 (watch mode)
cd web && npm run dev    # Web dashboard on :5175 (proxies /api → :21547)
npm run daemon           # Background scheduler

# Build
npm run build            # TypeScript → dist/
npm run build:web        # React → web/dist/
npm run build:all        # All (backend + web + electron)

# Test
npm run test             # 340 tests
npm run test:watch       # Watch mode
cd web && npm run test   # Web component tests (jsdom)

# Electron
npm run electron:dev     # Dev mode
npm run electron:pack    # Build .exe → release/
```

## Core Architecture

### Importance Formula (`src/engine/orbit.ts`)
```
importance = 0.35 × recency + 0.25 × frequency + 0.40 × intrinsic
```
- **Recency**: 24h grace period, then type-specific linear decay (decision=29d, task=2d, observation=1d)
- **Frequency**: temporally-decayed effective count (7-day half-life), log saturation
- **Intrinsic**: type-based default (procedural=0.85, decision=0.80, milestone=0.70, error=0.65, task=0.50, context=0.40, observation=0.30)
- Importance floor: 0.15 (auto-decay never goes below this)

### Distance Mapping (segment-based, 4 zones)
```
Core      [0.80, 1.00] → [0.1,  3.0) AU
Near      [0.50, 0.80) → [3.0,  15.0) AU
Stored    [0.20, 0.50) → [15.0, 60.0) AU
Forgotten [0.00, 0.20) → [60.0, 100.0] AU
```

### Orbital Zones
| Zone | AU Range | Purpose |
|------|----------|---------|
| Core | 0.1–3.0 | Instant recall (System 1) |
| Near | 3.0–15.0 | Recently accessed |
| Stored | 15.0–60.0 | Older, still searchable |
| Forgotten | 60.0–100.0 | Oort cloud |

### Corona Cache (`src/engine/corona.ts`)
- In-memory cache of core+near memories (RAM-based, auto 5% of system RAM)
- Token-indexed for O(1) keyword lookup
- Warmed on startup, invalidated on project switch

### Search: Hybrid Reciprocal Rank Fusion
1. FTS5 keyword search (trigram tokenizer for CJK)
2. sqlite-vec KNN vector search (1024d BGE-M3 embeddings)
3. RRF merge + retrieval re-ranking (0.55×semantic + 0.25×keyword + 0.20×proximity)

### Session Lifecycle
- **Session Ledger**: tracks every tool invocation per session
- **Sleep Consolidation**: 5-phase post-session pipeline (activity count, orbit recalc, dedup, summary, sun update)
- **Adaptive token budget**: scales sun context by session gap (short=1.0x, extended=1.8x)

## Key Patterns & Gotchas

### node:sqlite in Vitest (CRITICAL)
Vite doesn't recognize `node:sqlite`. The root `vitest.config.ts` has a **mandatory virtual module plugin** that uses `createRequire` to bridge it:
```typescript
// resolveId: 'node:sqlite' → '\0virtual:node-sqlite'
// load: createRequire(import.meta.url)('node:sqlite')
```
**Never remove this plugin** — all tests depend on it.

### ScanConfig Type Casting
```typescript
const config = JSON.parse(rawStr) as unknown as ScanConfig;
// db.prepare() returns primitives, needs double-cast
```

### Tokenizer (CJK-Aware)
`src/utils/tokenizer.ts` — CJK characters count ~2.0 tokens/char, ASCII ~1.3 tokens/word. Critical for sun context token budget.

### Access Boost on Recall
When a memory is recalled: `last_accessed_at` → now, `access_count++`, importance recalculated, distance shrinks → pulled closer to sun.

### Procedural Memories
Auto-discovered behavioral patterns (3+ memories sharing tags). Impact 0.9, decay 3.3× slower. Appear in sun context.

## Configuration (Environment Variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `STELLAR_DB_PATH` | `~/.stellar-memory/stellar.db` | Database location |
| `STELLAR_PROJECT` | `default` | Active project |
| `STELLAR_API_PORT` | `21547` | REST API port |
| `STELLAR_SUN_TOKEN_BUDGET` | `800` | Max tokens for sun context |
| `STELLAR_DECAY_HALF_LIFE` | `72` | Hours for recency decay fallback |
| `STELLAR_WEIGHT_RECENCY_V2` | `0.35` | Importance weight (recency) |
| `STELLAR_WEIGHT_FREQUENCY_V2` | `0.25` | Importance weight (frequency) |
| `STELLAR_WEIGHT_INTRINSIC` | `0.40` | Importance weight (intrinsic) |
| `STELLAR_CACHE_MB` | auto 5% | Corona cache RAM allocation |
| `STELLAR_EMBEDDING_DEVICE` | `cpu` | `cpu` / `dml` / `cuda` |
| `STELLAR_QUERY_CACHE_SIZE` | `128` | Query embedding LRU cache size |

## MCP Interface

### Resource
- `stellar://sun` — Current working context (core+near memories, within token budget)

### Tools (18)
`status`, `recall`, `remember`, `forget`, `commit`, `orbit`, `export`, `consolidate`, `resolve-conflict`, `temporal`, `constellation`, `observe`, `galaxy`, `analytics`, `scan`, `daemon`

## Database Schema (Key Tables)

- **memories** — id, project, content, summary, type, tags(JSON), distance, importance, impact, intrinsic, access_count, source_path, content_hash, quality_score, valid_from/until, is_universal
- **sun_state** — Per-project working context (current_work, decisions, next_steps, errors, context)
- **memories_fts** — FTS5 virtual table on content+summary+tags (trigram tokenizer)
- **data_sources** — Registered scan paths with status tracking
- **constellation_edges** — Knowledge graph relationships
- **orbit_log** — Audit trail of distance/importance changes
- **sessions** — Session lifecycle tracking (v1.1)
- **session_ledger** — Tool invocation log per session (v1.1)
- **schema_version** — Migration version tracking (v1.1)

## Web Dashboard

- **Port**: 5175 (dev), proxies `/api` → `:21547`
- **Polling**: memories 30s, sun 60s
- **i18n**: EN/KO toggle in header, `useTranslation()` hook, `Widen<T>` utility type for ko.ts literals
- **Theme**: Dark (charcoal + cyan/blue accents), Tailwind CSS
- **3D**: Three.js solar system + D3 orbital overlay

## Deployment Rule

**코드 수정 후 반드시 사용자에게 배포 여부를 확인받을 것.**
이 프로젝트는 npm에 배포되는 패키지이므로, 소스 수정만으로는 사용자들에게 반영되지 않는다.
수정이 끝나면 배포(버전 범프 → build → npm publish → git commit/push) 전에 반드시 나에게 물어볼 것.

## Coding Conventions

- Functions: `camelCase`, Constants: `UPPER_SNAKE_CASE`, Types: `PascalCase`
- Comments only when logic isn't self-evident
- Parameterized SQL queries only (no string interpolation)
- Zod for input validation at boundaries
- One responsibility per module
- Tests: Arrange → Act → Assert

## Scheduler Intervals

| Task | Interval |
|------|----------|
| Orbit recalculation | 1 hour |
| Memory decay | 6 hours |
| Consolidation check | 24 hours |

## Electron Notes

- `asar: false` in electron-builder (allows runtime DB access)
- `npmRebuild: false` (skip native module rebuild)
- Loads `web/dist/` for UI, spawns API server as child process
