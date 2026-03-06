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
| Embeddings | `@xenova/transformers` (all-MiniLM-L6-v2, 384d, local) |
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

tests/               # 15 test files, 252 tests
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
npm run test             # 252 tests
npm run test:watch       # Watch mode
cd web && npm run test   # Web component tests (jsdom)

# Electron
npm run electron:dev     # Dev mode
npm run electron:pack    # Build .exe → release/
```

## Core Architecture

### Importance Formula (`src/engine/orbit.ts`)
```
importance = 0.30 × recency + 0.20 × frequency + 0.30 × impact + 0.20 × relevance
```
- **Recency**: exponential decay, half-life 72h (`0.5^(hours/72)`)
- **Frequency**: log saturation (`log(1+count) / log(1+20)`)
- **Impact**: type-based default (decision=0.8, milestone=0.7, error=0.6, task=0.5, context=0.4, observation=0.3)
- **Relevance**: hybrid `0.7×vector + 0.3×keyword` similarity

### Distance Mapping
```
distance = 0.1 + (1 - importance)² × 99.9   // quadratic, range 0.1–100 AU
```

### Orbital Zones
| Zone | AU Range | Purpose |
|------|----------|---------|
| Core | 0.1–1.0 | Instant recall (System 1) |
| Near | 1.0–5.0 | Recently accessed |
| Active | 5.0–15.0 | In-context |
| Archive | 15.0–40.0 | Older |
| Fading | 40.0–70.0 | Losing relevance |
| Forgotten | 70.0–100.0 | Soft-deleted (Oort cloud) |

### Corona Cache (`src/engine/corona.ts`)
- In-memory cache of up to 200 core+near memories
- Token-indexed for O(1) keyword lookup
- Warmed on startup, invalidated on project switch

### Search: Hybrid Reciprocal Rank Fusion
1. FTS5 keyword search
2. sqlite-vec KNN vector search (384d embeddings)
3. RRF merge + re-rank

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
| `STELLAR_DECAY_HALF_LIFE` | `72` | Hours for 50% decay |
| `STELLAR_WEIGHT_RECENCY` | `0.30` | Importance weight |
| `STELLAR_WEIGHT_FREQUENCY` | `0.20` | Importance weight |
| `STELLAR_WEIGHT_IMPACT` | `0.30` | Importance weight |
| `STELLAR_WEIGHT_RELEVANCE` | `0.20` | Importance weight |

## MCP Interface

### Resource
- `stellar://sun` — Current working context (core+near memories, within token budget)

### Tools (18)
`status`, `recall`, `remember`, `forget`, `commit`, `orbit`, `export`, `consolidate`, `resolve-conflict`, `temporal`, `constellation`, `observe`, `galaxy`, `analytics`, `scan`, `daemon`

## Database Schema (Key Tables)

- **memories** — id, project, content, summary, type, tags(JSON), distance, importance, impact, access_count, source_path, content_hash, quality_score, valid_from/until, is_universal
- **sun_state** — Per-project working context (current_work, decisions, next_steps, errors, context)
- **memories_fts** — FTS5 virtual table on content+summary+tags
- **data_sources** — Registered scan paths with status tracking
- **constellation_edges** — Knowledge graph relationships
- **orbit_log** — Audit trail of distance/importance changes

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
