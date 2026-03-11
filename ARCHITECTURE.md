# STM Assembly Guide — LEGO Parts Catalog

> Every code module has a unique part number. Dependencies flow inward only: **outer → inner**.
>
> ```
> Layer 0 (Foundation)  U = Utils
> Layer 1 (Data)        S = Storage
> Layer 2 (Core)        E = Engine
> Layer 3 (Orchestrate) V = Services
> Layer 4 (Interface)   M = MCP  |  A = API  |  C = CLI
> Layer 5 (Background)  D = Daemon/Scheduler
> Layer 6 (External)    X = Scanner
> Layer 7 (Frontend)    W = Web Dashboard
> ```

---

## Layer 0 — Foundation (U)

No dependencies. Everyone can import these.

| Part | File | Lines | Role |
|------|------|-------|------|
| **U1** | `utils/config.ts` | 94 | Environment config → `getConfig()` |
| **U2** | `utils/logger.ts` | 116 | `createLogger(name)` → structured logging |
| **U3** | `utils/tokenizer.ts` | 50 | `estimateTokens()` — CJK-aware token counting |
| **U4** | `utils/time.ts` | 47 | `formatDuration`, `hoursAgo`, date helpers |

**Dependency rule**: U imports nothing from src/.

---

## Layer 1 — Storage (S)

Pure data access. SQL only. No business logic.

| Part | File | Lines | Role | Key Exports |
|------|------|-------|------|-------------|
| **S1** | `storage/database.ts` | 363 | SQLite init, migrations, FTS5+trigram | `initDatabase`, `getDatabase` |
| **S2** | `storage/queries.ts` | 1340 | All SQL queries (barrel) | 50+ query functions |
| **S3** | `storage/vec.ts` | 181 | sqlite-vec embeddings | `insertEmbedding`, `searchByVector` |

**Dependency rule**: S → U only. S must NOT import from E, M, A.

### S2 Internal Map (queries.ts — to be split)

| Sub-part | Domain | Functions |
|----------|--------|-----------|
| S2.1 | Memory CRUD | `insertMemory`, `getMemoryById`, `getMemoriesByProject`, `updateMemoryOrbit`, `softDeleteMemory`, `getMemoryByContentHash`, `updateQualityScore` |
| S2.2 | Sun State | `getSunState`, `upsertSunState` |
| S2.3 | Orbit Log | `insertOrbitLog`, `cleanupOrbitLog` |
| S2.4 | Constellation | `upsertEdge`, `getEdgesForMemory`, `deleteEdgesForMemory`, `getEdgesForBatch` |
| S2.5 | Conflicts | `insertConflict`, `getConflicts`, `resolveConflict`, `getUnresolvedConflicts` |
| S2.6 | Temporal | `setTemporalBounds`, `getMemoriesAtTime`, `getTemporalSummary` |
| S2.7 | Analytics | `getSurvivalData`, `getHealthMetrics` |
| S2.8 | Observation | `insertObservation`, `getObservations` |
| S2.9 | DataSource | `insertDataSource`, `getDataSources`, `updateDataSourceStatus` |
| S2.10 | Search | `searchMemories` (FTS5), `searchMemoriesInRange` |

---

## Layer 2 — Engine (E)

Core business logic. The brain.

### E1 — Types & Constants

| Part | File | Lines | Role |
|------|------|-------|------|
| **E1** | `engine/types.ts` | 211 | `Memory`, `SunState`, `OrbitChange`, `MemoryType`, `ORBIT_ZONES`, `IMPACT_DEFAULTS` |

### E2 — Orbital Mechanics (importance + distance)

| Part | File | Lines | Role | Key Exports |
|------|------|-------|------|-------------|
| **E2.1** | `engine/orbit.ts` | 390 | Importance formula, decay, orbit recalc | `calculateImportance`, `recalculateOrbits`, `recencyScore` |
| **E2.2** | `engine/gravity.ts` | 207 | Relevance scoring (keyword + vector) | `keywordRelevance`, `retrievalScore`, `cosineSimilarity` |
| **E2.3** | `engine/content-weight.ts` | 115 | Content type → weight multiplier | `calculateContentWeight` |
| **E2.4** | `engine/validity.ts` | 47 | Active/superseded/expired filter | `filterActiveMemories`, `isMemoryCurrentlyActive` |

### E3 — Memory Lifecycle

| Part | File | Lines | Role | Key Exports |
|------|------|-------|------|-------------|
| **E3.1** | `engine/planet.ts` | 635 | Create + recall + forget | `createMemory`, `recallMemoriesAsync`, `forgetMemory` |
| **E3.2** | `engine/quality.ts` | 300 | 4-dim quality scoring | `calculateQuality`, `qualityOrbitAdjustment` |
| **E3.3** | `engine/consolidation.ts` | 544 | Merge similar memories | `findSimilarMemory`, `enrichMemory`, `runConsolidation` |
| **E3.4** | `engine/embedding.ts` | 201 | all-MiniLM-L6-v2, 384d vectors | `generateEmbedding` |

### E4 — Context & State

| Part | File | Lines | Role | Key Exports |
|------|------|-------|------|-------------|
| **E4.1** | `engine/sun.ts` | 464 | Working context + proactive alerts | `getSunContent`, `commitToSun`, `formatSunContent` |
| **E4.2** | `engine/corona.ts` | 207 | In-memory cache (200 core+near) | `corona.warmup`, `corona.search`, `corona.upsert` |
| **E4.3** | `engine/session-policy.ts` | 129 | Session activity tracking | `noteRecall`, `noteRemember`, `getSessionCommitDraft` |

### E5 — Knowledge Graph & Relations

| Part | File | Lines | Role | Key Exports |
|------|------|-------|------|-------------|
| **E5.1** | `engine/constellation.ts` | 440 | Relationship extraction + graph | `extractRelationships`, `findRelatedMemories` |
| **E5.2** | `engine/conflict.ts` | 410 | Contradiction detection | `detectConflict`, `resolveConflict` |
| **E5.3** | `engine/temporal.ts` | 340 | Time-based queries + supersession | `setTemporalBounds`, `supersedeMemory`, `getContextAtTime` |

### E6 — Intelligence

| Part | File | Lines | Role | Key Exports |
|------|------|-------|------|-------------|
| **E6.1** | `engine/analytics.ts` | 584 | Survival curves, health, topics | `getFullAnalytics`, `getSurvivalCurve` |
| **E6.2** | `engine/observation.ts` | 436 | Conversation → memory extraction | `processConversation`, `extractMemoriesFromText` |
| **E6.3** | `engine/procedural.ts` | 308 | Behavioral pattern detection | `detectProceduralPattern` |
| **E6.4** | `engine/multiproject.ts` | 319 | Galaxy (multi-project) management | `switchProject`, `listAllProjects`, `markUniversal` |

**Dependency rule**: E → S, U. E must NOT import from M, A, V.

---

## Layer 3 — Services (V)

Orchestration layer. Unifies business flows for all interfaces.

| Part | File | Lines | Role | Key Exports |
|------|------|-------|------|-------------|
| **V1** | `engine/services/memory-service.ts` | ~120 | Full create pipeline (create + conflict + quality + constellation) | `createMemoryFull` |
| **V2** | `engine/services/recall-service.ts` | ~40 | Typed recall wrapper | `recallMemories` |
| **V3** | `engine/services/commit-service.ts` | ~30 | Session commit orchestration | `commitSession` |
| **V0** | `engine/services/index.ts` | ~5 | Barrel re-export | `*` |

**Dependency rule**: V → E, S, U. V must NOT import from M, A.

---

## Layer 4 — Interfaces (M, A, C)

### M — MCP (AI Interface)

| Part | File | Lines | Role | Key Exports |
|------|------|-------|------|-------------|
| **M0** | `mcp/server.ts` | 368 | Tool registration + stdio transport | `createStellarServer` |
| **M1** | `mcp/tools/memory-tools.ts` | 1231 | All 15 tool handlers (barrel) | `handleRemember`, `handleRecall`, ... |
| **M2** | `mcp/tools/ingestion-tools.ts` | 45 | Scan tool | `handleScan` |
| **M3** | `mcp/tools/daemon-tool.ts` | 72 | Daemon control | `handleDaemon` |

### M1 Internal Map (memory-tools.ts — to be split)

| Sub-part | Handlers |
|----------|----------|
| M1.1 | `handleRemember`, `handleRecall`, `handleForget` |
| M1.2 | `handleStatus`, `handleCommit`, `handleExport`, `handleOrbit` |
| M1.3 | `handleConstellation`, `handleResolveConflict` |
| M1.4 | `handleAnalytics`, `handleGalaxy` |
| M1.5 | `handleObserve`, `handleConsolidate` |
| M1.6 | `handleTemporal` |
| M1.7 | `handleSunResource` |

### A — API (REST Interface)

| Part | File | Lines | Role | Endpoints |
|------|------|-------|------|-----------|
| **A0** | `api/server.ts` | 115 | Hono app + route wiring | — |
| **A0.ws** | `api/websocket.ts` | 214 | WebSocket event bus | `emitMemory*`, `emitOrbit*` |
| **A1** | `api/routes/memories.ts` | 269 | Memory CRUD | `GET/POST/PATCH/DELETE /memories` |
| **A2** | `api/routes/sun.ts` | 51 | Sun state | `GET/POST /sun` |
| **A3** | `api/routes/system.ts` | 90 | Health + config | `GET /system/health` |
| **A4** | `api/routes/orbit.ts` | 93 | Orbit recalc | `POST /orbit/recalculate` |
| **A5** | `api/routes/constellation.ts` | 105 | Knowledge graph | `GET /constellation/:id` |
| **A6** | `api/routes/projects.ts` | 140 | Multi-project | `GET/POST /projects` |
| **A7** | `api/routes/analytics.ts` | 141 | Analytics reports | `GET /analytics/:report` |
| **A8** | `api/routes/temporal.ts` | 92 | Time queries | `GET /temporal/at` |
| **A9** | `api/routes/conflicts.ts` | 75 | Conflict mgmt | `GET/POST /conflicts` |
| **A10** | `api/routes/consolidation.ts` | 69 | Merge ops | `GET/POST /consolidation` |
| **A11** | `api/routes/observations.ts` | 48 | Observation log | `GET/POST /observations` |
| **A12** | `api/routes/scan.ts` | 455 | Data source scan | `POST /scan`, SSE streaming |

### C — CLI

| Part | File | Lines | Role |
|------|------|-------|------|
| **C0** | `cli/index.ts` | 52 | Command router |
| **C1** | `cli/init.ts` | 393 | Project initialization |
| **C2** | `cli/hooks/install.ts` | 113 | Git hook installer |
| **C3** | `cli/hooks/restore.ts` | 47 | Hook restore |
| **C4** | `cli/hooks/stop.ts` | 119 | Daemon stop |

**Dependency rule**: M, A, C → V, E, S, U. Never import between M↔A↔C.

---

## Layer 5 — Background (D)

| Part | File | Lines | Role | Key Exports |
|------|------|-------|------|-------------|
| **D1** | `service/daemon.ts` | 133 | Daemon lifecycle | `startDaemon`, `stopDaemon` |
| **D2** | `service/scheduler.ts` | 420 | Periodic tasks (orbit, decay, cleanup, curation) | `Scheduler`, `startScheduler` |

**Dependency rule**: D → E, S, U.

---

## Layer 6 — Scanner (X)

| Part | File | Lines | Role |
|------|------|-------|------|
| **X0** | `scanner/index.ts` | 518 | Scan orchestrator |
| **X1** | `scanner/types.ts` | 94 | `ScanConfig`, `ScanResult`, `FileEntry` |
| **X2** | `scanner/metadata-scanner.ts` | 390 | File metadata extraction |
| **X3** | `scanner/local/filesystem.ts` | 231 | File collection + hashing |
| **X4** | `scanner/local/git.ts` | 187 | Git history scanning |
| **X5** | `scanner/local/parsers/index.ts` | 30 | Parser selector |
| **X5.1** | `scanner/local/parsers/code.ts` | 129 | Code file parser |
| **X5.2** | `scanner/local/parsers/json-parser.ts` | 135 | JSON parser |
| **X5.3** | `scanner/local/parsers/markdown.ts` | 126 | Markdown parser |
| **X5.4** | `scanner/local/parsers/text.ts` | 47 | Plain text parser |

---

## Layer 7 — Web Dashboard (W)

| Part | File | Lines | Role |
|------|------|-------|------|
| **W0** | `web/src/main.tsx` | 32 | Entry + router |
| **W0.api** | `web/src/api/client.ts` | 376 | REST API client |
| **W1** | `web/src/App.tsx` | 752 | Main dashboard shell |
| **W2** | `web/src/components/Layout.tsx` | 259 | Header + sidebar + nav |
| **W3** | `web/src/components/LandingPage.tsx` | 936 | Public landing page |
| **W4** | `web/src/components/OnboardingScreen.tsx` | 686 | First-time setup wizard |
| | | | |
| **W10** | `web/src/components/SolarSystem.tsx` | 1621 | 3D orbital visualization (Three.js) |
| **W11** | `web/src/components/Sun.tsx` | 41 | Sun glow effect |
| **W12** | `web/src/components/Planet.tsx` | 13 | Memory planet dot |
| **W13** | `web/src/components/OrbitRing.tsx` | 37 | Zone ring |
| | | | |
| **W20** | `web/src/components/MemoryDetail.tsx` | 1045 | Memory inspector panel |
| **W21** | `web/src/components/SearchBar.tsx` | 421 | Search + filters |
| **W22** | `web/src/components/StatsBar.tsx` | 552 | Zone statistics |
| **W23** | `web/src/components/ZoneStats.tsx` | 253 | Zone breakdown |
| | | | |
| **W30** | `web/src/components/AnalyticsDashboard.tsx` | 586 | Analytics charts |
| **W31** | `web/src/components/DataSources.tsx` | 763 | Data source manager |
| **W32** | `web/src/components/ProjectSwitcher.tsx` | 351 | Project switcher |
| **W33** | `web/src/components/TemporalTimeline.tsx` | 381 | Timeline view |
| **W34** | `web/src/components/ConflictsPanel.tsx` | 280 | Conflict resolution UI |
| **W35** | `web/src/components/ConsolidationPanel.tsx` | 276 | Memory merge UI |
| **W36** | `web/src/components/ProceduralRules.tsx` | 282 | Behavioral patterns |
| **W37** | `web/src/components/ObservationLog.tsx` | 196 | Observation history |
| | | | |
| **W40** | `web/src/components/charts/LineChart.tsx` | 214 | D3 line chart |
| **W41** | `web/src/components/charts/BarChart.tsx` | 103 | D3 bar chart |
| **W42** | `web/src/components/charts/RingChart.tsx` | 71 | D3 donut chart |
| | | | |
| **W50** | `web/src/hooks/useRouter.ts` | 34 | Client-side routing |
| **W51** | `web/src/hooks/useWebSocket.ts` | 139 | Real-time updates |
| | | | |
| **W60** | `web/src/i18n/context.tsx` | 104 | i18n provider |
| **W61** | `web/src/i18n/en.ts` | 351 | English strings |
| **W62** | `web/src/i18n/ko.ts` | 340 | Korean strings |

---

## Dependency Map (must-follow rules)

```
Allowed:                          Forbidden:

W ──→ (HTTP only, no src/ import)  W ✗→ any src/ file

M ──→ V, E, S, U                   M ✗→ A
A ──→ V, E, S, U                   A ✗→ M
C ──→ V, E, S, U                   C ✗→ M, A

D ──→ E, S, U                      D ✗→ M, A, V
X ──→ E, S, U                      X ✗→ M, A, V

V ──→ E, S, U                      V ✗→ M, A, D, X
E ──→ S, U                         E ✗→ M, A, V, D, X
S ──→ U                            S ✗→ E, M, A, V, D, X
U ──→ (nothing)                    U ✗→ everything
```

## Known Violations (to fix)

| Violation | Current | Fix |
|-----------|---------|-----|
| E3.1 → M1 | `planet.ts` imports `trackBgError` from `memory-tools.ts` | Callback injection |
| S2 → E1 | `queries.ts` imports `ORBIT_ZONES` from `types.ts` | Copy constant or parameterize |
| S2 → E2.4 | `queries.ts` imports `filterActiveMemories` from `validity.ts` | Move filtering to caller |
| E2.1 → S1 | `orbit.ts` calls `getDatabase()` + raw SQL | Move to S2.3 |
| E4.1 → S1 | `sun.ts` calls `getDatabase()` + raw SQL | Move to S2.2 |
| E6.1 → S1 | `analytics.ts` calls `getDatabase()` + raw SQL | Move to S2.7 |
| E5.1 → S1 | `constellation.ts` calls `getDatabase()` + raw SQL | Move to S2.4 |
| E5.3 → S1 | `temporal.ts` calls `getDatabase()` + raw SQL | Move to S2.6 |
| E5.2 → S1 | `conflict.ts` calls `getDatabase()` + raw SQL | Move to S2.5 |
| E6.4 → S1 | `multiproject.ts` calls `getDatabase()` + raw SQL | Move to S2.10+ |
| E3.3 → S1 | `consolidation.ts` calls `getDatabase()` + raw SQL | Move to S2.1 |

## Stats

| Layer | Files | Lines | % |
|-------|-------|-------|---|
| U (Utils) | 4 | 307 | 1.1% |
| S (Storage) | 4 | 1,884 | 6.9% |
| E (Engine) | 20 | 6,456 | 23.7% |
| V (Services) | 4 | ~195 | 0.7% |
| M (MCP) | 4 | 1,716 | 6.3% |
| A (API) | 14 | 2,057 | 7.6% |
| C (CLI) | 5 | 724 | 2.7% |
| D (Daemon) | 2 | 553 | 2.0% |
| X (Scanner) | 10 | 1,907 | 7.0% |
| **Backend Total** | **67** | **15,799** | **58.0%** |
| W (Web) | 35 | 11,443 | 42.0% |
| **Grand Total** | **102** | **27,242** | **100%** |
