# Show HN Draft

## Title Options

1. **Show HN: Stellar Memory -- AI memory system using orbital mechanics for importance decay**
2. Show HN: Stellar Memory -- Persistent AI context where important memories orbit closer
3. Show HN: I built an MCP memory server that uses celestial mechanics as a cognitive model

Recommended: Option 1 (73 chars, descriptive, technically specific)

---

## Post Body

**Show HN: Stellar Memory -- AI memory system using orbital mechanics for importance decay**

I built a persistent memory system for AI assistants that uses celestial mechanics as a cognitive model. Important memories orbit close to the Sun for instant recall. Forgotten ones drift to the Oort Cloud.

**The problem:** AI memory today is either nonexistent (start fresh every session) or a flat file with no ranking. Claude Code's built-in MEMORY.md is limited to 200 lines, has no search, no importance weighting, no decay. Existing memory services (Mem0, Zep) are cloud-hosted, require API keys, and send your data to someone else's server.

**The approach:** I modeled memory after orbital mechanics. Every memory gets an importance score from four factors:

```
importance = 0.30 * recency + 0.20 * frequency + 0.30 * impact + 0.20 * relevance
```

This maps to an orbital distance (0.1--100 AU) using a quadratic curve. High importance = close orbit = fast recall. Low importance = distant orbit = effectively forgotten. Recency uses exponential decay with a 72-hour half-life, so memories naturally fade unless you keep accessing them.

**What makes it different:**

- **Fully local.** SQLite (Node.js built-in `node:sqlite`), local embeddings via `@xenova/transformers` (all-MiniLM-L6-v2, 384d). No API keys, no cloud, no data leaving your machine.

- **Hybrid search.** FTS5 keyword search + sqlite-vec KNN vector search, merged via Reciprocal Rank Fusion. Handles both exact matches ("JWT auth error") and semantic matches ("login token issue").

- **Corona cache.** An in-memory tier of the 200 closest memories with a token index for O(1) keyword lookup. Mimics System 1 thinking -- your most critical knowledge is always sub-millisecond.

- **MCP native.** 16 tools and 1 resource, works with Claude Code and Claude Desktop out of the box. The `stellar://sun` resource auto-loads working context at session start.

- **3D visualization.** React + Three.js dashboard that renders your memories as a solar system. You can see which decisions orbit close and which knowledge is drifting away.

- **Multi-project isolation.** Each project is its own star system. You can mark memories as "universal" so they appear across projects (like knowing your preferred coding style applies everywhere).

- **Knowledge graph.** Typed relationships between memories (uses, caused_by, part_of, contradicts, supersedes) form a constellation you can traverse.

**Technical details:**

- TypeScript, ESM throughout, ~18k lines
- Node.js 22+ (for built-in `node:sqlite`)
- 252 tests (Vitest)
- REST API via Hono (port 21547) with 13 route groups
- Background daemon for scheduled orbit recalculation and decay
- Electron desktop app (Windows)
- CJK-aware tokenizer (Korean + English)

**Limitations / honest notes:**

- The embedding model is ~90 MB and downloads on first run. After that, it's fully offline.
- sqlite-vec is still alpha. It works well in practice but the API is evolving.
- Node.js 22+ is a hard requirement because `node:sqlite` doesn't exist in earlier versions.
- The orbital mechanics metaphor is just that -- a metaphor. But it turns out to map surprisingly well to how memory importance actually works: exponential decay, frequency reinforcement, context-dependent relevance.
- Currently optimized for single-user. No auth layer on the REST API (it binds to localhost only).

**What I learned building it:**

The hardest part wasn't the orbital math -- it was getting `node:sqlite` to work inside Vite's module resolver for testing. Vite doesn't recognize the `node:` prefix, so I had to write a virtual module plugin that uses `createRequire` to bridge the gap. Small thing, but it blocked me for a while.

The procedural memory system was an unexpected win. When 3+ memories share the same tags, the system automatically creates a "procedural memory" with 0.9 impact and 3.3x slower decay. These capture behavioral patterns ("always run tests before committing") that emerge organically.

GitHub: [link]
Live dashboard demo: [link]
Docs: [link]

I'd love feedback on the importance formula tuning and whether the orbital metaphor resonates or feels like unnecessary abstraction.

---

## Notes for Posting

### Best posting times
- Weekday mornings (US Eastern), around 8-10 AM EST
- Avoid weekends and holidays

### Anticipated HN comments and responses

**"This is just a vector database with extra steps"**
The vector search is one of six components. The core innovation is the importance decay model -- memories don't just sit in a database, they actively drift based on recency, frequency, impact, and relevance. The orbital distance is a real performance differentiator via the corona cache, not just a visualization gimmick.

**"Why not just use a flat file / MEMORY.md?"**
A flat file has no search, no importance ranking, no decay, no multi-project support, and a hard size limit. It works for small projects but doesn't scale. Stellar Memory handles thousands of memories across multiple projects with sub-millisecond recall for the most important ones.

**"Why Node.js 22+? That's cutting edge."**
`node:sqlite` eliminates the need for native module compilation (no `better-sqlite3`, no `node-gyp`, no platform-specific binaries for the core DB). The tradeoff is a newer Node.js requirement, but Node 22 has been LTS since October 2024.

**"The celestial mechanics metaphor seems over-engineered"**
The metaphor maps to real concepts: distance = retrieval cost, gravity = contextual pull, decay = forgetting curve, orbit = stable importance equilibrium. It's not just theming -- it provides a consistent framework for reasoning about memory behavior. That said, you can ignore the metaphor entirely and just use it as a scored memory system.

**"No auth on the API?"**
Correct -- it binds to localhost only and is designed for single-user local use. If you need remote access, put it behind a reverse proxy with auth.

**"How does it compare to Mem0 / Zep?"**
Key differences: fully local (no cloud dependency), MCP native (not just REST), orbital decay model (not just recency), knowledge graph, 3D visualization, multi-project support. Mem0 and Zep are solid products but they're cloud services. Stellar Memory is a local-first tool you own completely.
