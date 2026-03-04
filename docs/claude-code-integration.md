# Stellar Memory: Claude Code Integration Guide

Stellar Memory is a persistent memory upgrade for Claude Code. It replaces the built-in 200-line MEMORY.md with an orbital memory system that scales to thousands of memories, searches them intelligently, and lets important knowledge naturally fade when it's no longer relevant.

## Why Stellar Memory?

### Comparison: Built-in MEMORY.md vs Stellar Memory

| Capability | Claude Code MEMORY.md | Stellar Memory |
|---|---|---|
| **Storage** | Single flat file, ~200 lines | SQLite database, unlimited memories |
| **Search** | None (full file loaded into context) | Hybrid FTS5 keyword + vector KNN, Reciprocal Rank Fusion |
| **Importance ranking** | None -- all lines equal | 4-factor formula: recency, frequency, impact, relevance |
| **Decay / forgetting** | Manual editing only | Exponential decay (72h half-life), automatic orbit drift |
| **Context budget** | 200 lines, always fully loaded | Token-budgeted sun context (default 800 tokens, configurable) |
| **Multi-project** | One file per project | Galaxy system with cross-project universal memories |
| **Visualization** | None | 3D solar system dashboard (Three.js + D3) |
| **Knowledge graph** | None | Constellation: typed edges (uses, caused_by, contradicts, etc.) |
| **Conflict detection** | None | Automatic detection of contradicting memories |
| **Quality scoring** | None | Specificity, actionability, uniqueness, freshness metrics |
| **Temporal queries** | None | Point-in-time recall, evolution chains |
| **Analytics** | None | Health reports, topic clusters, survival curves |
| **Data ingestion** | Manual only | Filesystem + git log scanner with parsers |
| **Consolidation** | Manual only | Automatic duplicate detection and merge suggestions |
| **Background tasks** | None | Daemon: scheduled recalculation, decay, consolidation |
| **Data location** | `.claude/` directory | `~/.stellar-memory/stellar.db` (configurable) |
| **Data privacy** | Local file | Local SQLite + local embeddings, zero cloud |

### When MEMORY.md is enough

If your project is small, you work alone, and you only need to remember a handful of conventions, MEMORY.md works fine. It's simple and built in.

### When you need Stellar Memory

- You work across **multiple projects** and want knowledge to transfer
- You have **hundreds of decisions, errors, and patterns** to track
- You want memories to **automatically fade** when they become irrelevant
- You need to **search** past knowledge rather than scan a flat file
- You want to **visualize** what your AI assistant knows and how it's changing
- You care about **quality** -- knowing which memories are actionable vs stale

## Setup

### Step 1: Install Stellar Memory

```bash
git clone https://github.com/your-username/stellar-memory.git
cd stellar-memory
npm install
npm run build
```

### Step 2: Configure Claude Code MCP

Add Stellar Memory to your Claude Code MCP settings.

**Global setup** (all projects): Edit `~/.claude/settings.json`

**Per-project setup**: Edit `.claude/settings.json` in your project root

Add the `mcpServers` configuration:

```json
{
  "mcpServers": {
    "stellar-memory": {
      "command": "node",
      "args": ["/absolute/path/to/stellar-memory/dist/index.js"],
      "env": {
        "STELLAR_PROJECT": "my-project-name"
      }
    }
  }
}
```

Replace `/absolute/path/to/stellar-memory` with the actual path where you cloned the repository.

**Windows example:**
```json
{
  "mcpServers": {
    "stellar-memory": {
      "command": "node",
      "args": ["C:/Users/you/stellar-memory/dist/index.js"],
      "env": {
        "STELLAR_PROJECT": "my-project"
      }
    }
  }
}
```

### Step 3: Verify the Connection

Start a new Claude Code session. You should see Stellar Memory listed as an available MCP server. Verify by asking Claude to:

```
Read the stellar://sun resource and call the status tool.
```

If working, you'll see the sun state and memory system status.

### Step 4 (Optional): Add Auto-Trigger Instructions

Add these instructions to your project's `CLAUDE.md` to get automatic memory behavior:

```markdown
# Stellar Memory Protocol

## Session Start
1. Read the `stellar://sun` resource to restore working context
2. Call `recall` with keywords from the current task
3. Call `status(show: "all", limit: 20)` for the full memory landscape

## During Work
Store memories immediately when:
- Architecture/design decisions are made (type: decision, impact: 0.8)
- Bugs are found or resolved (type: error, impact: 0.7)
- Features are completed (type: milestone, impact: 0.7)
- Important context is discovered (type: context, impact: 0.5)

## Session End
Call `commit` with:
- current_work: what was being worked on
- decisions: list of decisions made
- next_steps: concrete actions for next session
- errors: unresolved blockers
```

### Step 5 (Optional): Start the Dashboard

```bash
# Terminal 1: API server
cd stellar-memory
npm run api

# Terminal 2: Web dashboard
cd stellar-memory/web
npm run dev
```

Open http://localhost:5175 to see your memories orbiting in 3D.

## Usage Examples

### Auto-Recall on Session Start

When you start a new Claude Code session, Stellar Memory reads `stellar://sun` to restore context from the last session. This includes:

- What you were working on
- Decisions made
- Next steps planned
- Unresolved errors

The `recall` tool then searches for memories relevant to the current task, pulling them closer to the Sun (increasing their importance).

### Remembering Decisions

When Claude Code makes a design decision during a session:

```
Tool call: remember
  content: "Chose Redis over Memcached for session caching because
            the project needs pub/sub for real-time notifications
            and Redis supports it natively."
  type: "decision"
  impact: 0.8
  tags: ["redis", "caching", "architecture"]
```

This memory starts in the Core zone (0.1-1.0 AU). If you don't access it for a few days, it gradually drifts outward. If you access it again, it snaps back closer.

### Tracking Errors

```
Tool call: remember
  content: "Auth middleware returning 401 was caused by expired JWT
            secret rotation. Fixed by adding automatic key refresh
            every 24 hours in auth/keys.ts."
  type: "error"
  impact: 0.7
  tags: ["auth", "jwt", "middleware"]
```

### Committing Session State

At the end of a conversation:

```
Tool call: commit
  current_work: "Implementing WebSocket real-time updates for the dashboard"
  decisions: [
    "Using ws library instead of Socket.io for smaller bundle",
    "Broadcasting memory changes via pub/sub pattern"
  ]
  next_steps: [
    "Add WebSocket connection to web client",
    "Implement reconnection logic with exponential backoff",
    "Add tests for WebSocket message handlers"
  ]
  errors: ["CORS issue with WebSocket upgrade on Firefox"]
```

The next session starts with full context of where you left off.

### Cross-Project Knowledge

Mark a memory as universal so it appears in all projects:

```
Tool call: galaxy
  action: "mark_universal"
  memory_id: "abc-123"
  is_universal: true
```

Universal memories are useful for personal preferences, team conventions, and cross-cutting concerns that apply everywhere.

### Searching Past Knowledge

```
Tool call: recall
  query: "authentication error handling"
  limit: 5
```

Returns the top 5 memories matching "authentication error handling" via hybrid search, and pulls them closer to the Sun (boosting their importance since they're being used again).

## Configuration

Customize Stellar Memory by adding environment variables to the MCP config:

```json
{
  "mcpServers": {
    "stellar-memory": {
      "command": "node",
      "args": ["/path/to/stellar-memory/dist/index.js"],
      "env": {
        "STELLAR_PROJECT": "my-project",
        "STELLAR_DB_PATH": "/custom/path/stellar.db",
        "STELLAR_SUN_TOKEN_BUDGET": "1200",
        "STELLAR_DECAY_HALF_LIFE": "168",
        "STELLAR_WEIGHT_RECENCY": "0.25",
        "STELLAR_WEIGHT_FREQUENCY": "0.25",
        "STELLAR_WEIGHT_IMPACT": "0.25",
        "STELLAR_WEIGHT_RELEVANCE": "0.25"
      }
    }
  }
}
```

| Variable | Default | Tuning |
|----------|---------|--------|
| `STELLAR_SUN_TOKEN_BUDGET` | 800 | Increase for richer session start context, decrease to save tokens |
| `STELLAR_DECAY_HALF_LIFE` | 72 (hours) | Increase for longer memory retention (168 = 1 week half-life) |
| Weights | 0.30/0.20/0.30/0.20 | Must sum to 1.0. Increase recency for faster forgetting, increase impact for type-based ranking |

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `status` | System snapshot -- memories by zone, data sources |
| `recall` | Hybrid search with access boost |
| `remember` | Store a new memory |
| `forget` | Soft-delete (push to Oort Cloud) or hard-delete |
| `commit` | Save session state to the Sun |
| `orbit` | Force orbit recalculation |
| `scan` | Ingest local files + git history |
| `daemon` | Control background scheduler |
| `constellation` | Knowledge graph exploration |
| `galaxy` | Multi-project management |
| `analytics` | Health reports, topic clusters, survival curves |
| `observe` | Auto-extract memories from conversation |
| `consolidate` | Find and merge similar memories |
| `resolve_conflict` | Manage contradicting memories |
| `temporal` | Point-in-time queries, evolution chains |
| `export` | Backup as JSON or Markdown |

## MCP Resource

| URI | Description |
|-----|-------------|
| `stellar://sun` | Working context (auto-read at session start) |

## Migrating from MEMORY.md

If you have an existing MEMORY.md with valuable content, you can import it:

1. Open a Claude Code session with Stellar Memory configured
2. Ask Claude to read your MEMORY.md and store each section as a memory:

```
Read my MEMORY.md and use the remember tool to store each distinct
piece of knowledge as a separate memory. Use appropriate types
(decision, context, observation) and tags.
```

3. After import, your MEMORY.md content lives in Stellar Memory with proper search, ranking, and decay. You can keep MEMORY.md for quick-reference notes or remove it.
