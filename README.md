# Stellar Memory

**Persistent AI memory powered by celestial mechanics.**

Important memories orbit close to the Sun. Forgotten ones drift to the Oort Cloud.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org)

---

Stellar Memory is a local-first, persistent memory system for AI assistants. It uses **orbital mechanics as a cognitive model** -- memories with high importance orbit close to the Sun for instant recall, while stale knowledge naturally drifts outward through exponential decay. No cloud services, no API keys, no data leaving your machine.

## Key Features

- **Orbital Importance Model** -- 4-factor scoring (recency, frequency, impact, relevance) maps each memory to an orbital distance from 0.1 to 100 AU
- **Hybrid Search** -- FTS5 keyword search + sqlite-vec KNN vector search, merged via Reciprocal Rank Fusion
- **Local Embeddings** -- all-MiniLM-L6-v2 (384d) runs entirely in-process via `@xenova/transformers`
- **Corona Cache** -- in-memory tier of up to 200 core memories for sub-millisecond recall
- **MCP Native** -- 16 tools + 1 resource, works with Claude Code, Codex, Claude Desktop, and other MCP clients
- **REST API** -- Hono server on port 21547 with 13 route groups
- **3D Dashboard** -- React + Three.js solar system visualization with D3 orbital overlay
- **Multi-Project** -- isolated memory spaces (galaxies) with cross-project universal memories
- **Knowledge Graph** -- constellation of typed relationships between memories
- **Temporal Awareness** -- time-bounded memories, evolution chains, point-in-time queries
- **Conflict Detection** -- automatic detection of contradicting memories with resolution workflow
- **Quality Scoring** -- specificity, actionability, uniqueness, freshness metrics per memory
- **Procedural Memories** -- auto-discovered behavioral patterns that decay 3.3x slower
- **Background Daemon** -- scheduled orbit recalculation, decay, and consolidation
- **Zero Dependencies on Cloud** -- everything runs locally with `node:sqlite` and local embeddings

## How It Works

```
                         importance = 0.30 x recency
                                    + 0.20 x frequency
                                    + 0.30 x impact
                                    + 0.20 x relevance

         distance = 0.1 + (1 - importance)^2 x 99.9

    .  *  .        .          *       .        .     *   .
         .    * .        .        .        .
              .  CORE (0.1-1 AU)     .
      .    .  instant recall     .    *
         *   . . . . . . . .  .         .
       .  NEAR (1-5 AU)  .        .
      .   recently used   .    *         .
         . . . . . . . . . .       .          *
    .  ACTIVE (5-15 AU)       .        .
       in-context memories   .    .         .
      . . . . . . . . . . . . .     *          .
    ARCHIVE (15-40 AU)     .           .
      older knowledge    .       .          .
      . . . . . . . . . . . . . . .   *
     FADING (40-70 AU)          .         .
       losing relevance       .     .        .
      . . . . . . . . . . . . . . . . . .
     FORGOTTEN (70-100 AU)              .
       the Oort Cloud -- soft deleted     .
```

When you recall a memory, it gets pulled closer to the Sun. When you stop using it, exponential decay pushes it outward. The half-life is 72 hours by default.

## Quick Start

### Prerequisites

- **Node.js 22+** (required for built-in `node:sqlite`)
- **npm 9+**

### Install

```bash
git clone https://github.com/your-username/stellar-memory.git
cd stellar-memory
npm install
npm run build
```

### Use with Claude Code (MCP)

Add to your Claude Code MCP settings (`~/.claude/settings.json` or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "stellar-memory": {
      "command": "node",
      "args": ["/absolute/path/to/stellar-memory/dist/index.js"],
      "env": {
        "STELLAR_PROJECT": "my-project"
      }
    }
  }
}
```

Then in Claude Code, Stellar Memory automatically:
1. Reads `stellar://sun` to restore working context at session start
2. Recalls relevant memories when topics change
3. Stores decisions, errors, and milestones as they happen
4. Commits session state before the conversation ends

### Use with Codex

Add this block to `~/.codex/config.toml`:

```toml
[mcp_servers."stellar-memory"]
command = "node"
args = ["/absolute/path/to/stellar-memory/dist/index.js"]
```

Or use the setup helper:

```bash
npx stellar-memory init --codex
```

That command also installs a Stellar Memory workflow section into the project `AGENTS.md` so Codex restores context, recalls before guessing, and commits before ending work.

Codex does not support Claude-style session hooks. In Codex, the MCP server still works normally, and the first Stellar tool response can restore saved sun context.

### Use with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "stellar-memory": {
      "command": "node",
      "args": ["/absolute/path/to/stellar-memory/dist/index.js"],
      "env": {
        "STELLAR_PROJECT": "my-project"
      }
    }
  }
}
```

### Run the Dashboard

```bash
# Start the API server
npm run api

# In another terminal, start the web dashboard
cd web && npm run dev
```

Open http://localhost:5175 to see your memories orbiting in 3D.

### Run the Background Daemon

```bash
npm run daemon
```

The daemon runs scheduled tasks:
| Task | Interval |
|------|----------|
| Orbit recalculation | 1 hour |
| Memory decay | 6 hours |
| Consolidation check | 24 hours |

## System Requirements

| Requirement | Minimum |
|-------------|---------|
| Node.js | 22.0.0+ (for `node:sqlite`) |
| npm | 9.0.0+ |
| Disk | ~100 MB (embedding model) + DB |
| RAM | ~200 MB (model + corona cache) |
| OS | Windows, macOS, Linux |

The embedding model (~90 MB) downloads automatically on first use and is cached in `~/.cache/huggingface`.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `STELLAR_DB_PATH` | `~/.stellar-memory/stellar.db` | SQLite database file location |
| `STELLAR_PROJECT` | `default` | Active project name |
| `STELLAR_API_PORT` | `21547` | REST API port |
| `STELLAR_SUN_TOKEN_BUDGET` | `800` | Max tokens for sun context resource |
| `STELLAR_DECAY_HALF_LIFE` | `72` | Hours for 50% recency decay |
| `STELLAR_WEIGHT_RECENCY` | `0.30` | Weight for recency in importance formula |
| `STELLAR_WEIGHT_FREQUENCY` | `0.20` | Weight for access frequency |
| `STELLAR_WEIGHT_IMPACT` | `0.30` | Weight for memory type impact |
| `STELLAR_WEIGHT_RELEVANCE` | `0.20` | Weight for contextual relevance |

## Architecture

### Project Structure

```
src/
  engine/          Core: orbit, gravity, corona, embedding, quality, analytics
  storage/         database.ts, queries.ts, vec.ts (sqlite-vec)
  mcp/             MCP server + tools (memory-tools, ingestion-tools, daemon-tool)
  api/             Hono REST server + 12 route modules
  scanner/         Filesystem + git log scanners with file parsers
  service/         Background daemon + scheduler
  utils/           Config, logger, tokenizer, time helpers

web/src/
  components/      SolarSystem (Three.js), Layout, SearchBar, MemoryDetail, etc.
  api/client.ts    REST API client
  i18n/            EN/KO internationalization (React Context)

tests/             15 test files, 252 tests (Vitest)
electron/          Desktop app (Electron 40)
```

### Database

SQLite via Node.js built-in `node:sqlite` with three search layers:

1. **memories** table -- structured storage with 20+ columns
2. **memories_fts** -- FTS5 virtual table for keyword search
3. **memory_vec** -- sqlite-vec virtual table for 384-dimension KNN search

### Search Pipeline

```
Query
  |
  +---> FTS5 keyword search ----+
  |                              |---> Reciprocal Rank Fusion ---> Re-ranked results
  +---> sqlite-vec KNN search --+
```

The hybrid approach handles both exact matches ("JWT authentication error") and semantic matches ("login token expired").

### Corona Cache

An in-memory tier holding up to 200 core + near zone memories with a token index for O(1) keyword lookup. The corona mirrors how human System 1 thinking works -- your most important knowledge is always instantly available.

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `status` | View memory system state, grouped by orbital zone |
| `recall` | Hybrid search -- finds memories and pulls them closer |
| `remember` | Store a new memory with type, impact, and tags |
| `forget` | Push a memory to the Oort Cloud or permanently delete it |
| `commit` | Save session state to the Sun (working context) |
| `orbit` | Force recalculation of all orbital positions |
| `scan` | Ingest a local directory into memories (idempotent) |
| `daemon` | Start/stop/status of the background scheduler |
| `constellation` | Explore the knowledge graph between memories |
| `galaxy` | Multi-project management (switch, list, universal memories) |
| `analytics` | System insights: health, topics, survival curves, movements |
| `observe` | Auto-extract memories from conversation text |
| `consolidate` | Find and merge duplicate/similar memories |
| `resolve_conflict` | View and resolve contradicting memories |
| `temporal` | Point-in-time queries and memory evolution chains |
| `export` | Backup memories as JSON or Markdown |

### Resource

| URI | Description |
|-----|-------------|
| `stellar://sun` | Current working context (core + near memories within token budget) |

## REST API

The API server runs on port 21547 (default) and exposes:

```
GET    /api/health                    Health check
GET    /api/memories                  List memories (with filters)
POST   /api/memories                  Create a memory
GET    /api/memories/:id              Get a single memory
PATCH  /api/memories/:id              Update a memory
DELETE /api/memories/:id              Delete a memory
GET    /api/sun                       Get sun state
POST   /api/sun/commit                Commit session state
POST   /api/orbit/recalculate         Trigger orbit recalculation
GET    /api/constellation/:id         Get knowledge graph
GET    /api/projects                  List projects
POST   /api/projects                  Create a project
GET    /api/analytics/:report         Get analytics report
GET    /api/temporal/at               Point-in-time query
GET    /api/conflicts                 List conflicts
POST   /api/scan                      Scan a directory
GET    /api/sources                   List data sources
POST   /api/observations              Submit conversation for observation
POST   /api/consolidation             Run consolidation
```

## Development

```bash
# Run MCP server in dev mode (stdio, watch)
npm run dev

# Run API server in dev mode (watch)
npm run api

# Run web dashboard (proxies /api to :21547)
cd web && npm run dev

# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Build everything
npm run build:all

# Build Electron desktop app
npm run electron:pack
```

## Troubleshooting

### "Cannot find module 'node:sqlite'"

You need Node.js 22 or later. The `node:sqlite` module is a built-in that was added in Node.js 22.

```bash
node --version  # Must be >= 22.0.0
```

### Embedding model download hangs

The all-MiniLM-L6-v2 model (~90 MB) downloads from Hugging Face on first use. If it hangs:

1. Check your internet connection
2. Try setting a proxy: `export HTTPS_PROXY=http://your-proxy:port`
3. The model caches to `~/.cache/huggingface` -- delete that directory to force re-download

### sqlite-vec load failure

The `sqlite-vec` extension uses a native binary. If it fails to load:

1. Ensure you ran `npm install` (the binary is fetched during install)
2. On some platforms, you may need to build from source -- see [sqlite-vec docs](https://github.com/asg017/sqlite-vec)
3. Stellar Memory works without sqlite-vec (falls back to keyword-only search)

### "SQLITE_ERROR: database is locked"

Only one process should write to the database at a time. If you're running both the MCP server and API server, they share the same database file and SQLite handles locking. If you see this error:

1. Check for zombie processes: `ps aux | grep stellar`
2. Ensure you're not running multiple MCP server instances

### Web dashboard shows no memories

1. Confirm the API server is running: `curl http://localhost:21547/api/health`
2. Confirm the web dev server proxies correctly (check `web/vite.config.ts`)
3. Check browser console for CORS errors

## Testing

```bash
# Run the full test suite (252 tests)
npm run test

# Run with coverage
npx vitest run --coverage

# Run specific test file
npx vitest run tests/orbit.test.ts

# Web component tests
cd web && npm run test
```

The test suite uses a virtual module plugin in `vitest.config.ts` to bridge `node:sqlite` for Vite's module resolver. This is required because Vite does not natively recognize Node.js built-in modules with the `node:` prefix.

## License

MIT

