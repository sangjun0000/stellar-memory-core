# STM Improvement Roadmap

## Goal

Improve Stellar Memory in three linked areas without destabilizing the current MCP/server flow:

1. Adaptive importance scoring
2. Smoother memory automation
3. Stronger validity and supersession handling

The implementation order should be validity first, importance second, automation third. All three can be designed together, but they should not be merged into production code in parallel without a shared data model.

## Current Assessment

### Importance

Current importance in `src/engine/orbit.ts` is effectively:

- activation = recency + frequency blend
- storage importance = activation x contentWeight x qualityModifier

This is clean, but it underweights:

- current task relevance
- whether the memory is still valid now
- whether the memory was actually reused recently
- whether the memory is only project-local vs globally reusable

### Automation

Current automation is split across:

- `src/engine/observation.ts`
- `src/engine/sun.ts`
- Claude-only hooks in `src/cli/hooks/*`
- Codex guidance via `AGENTS.md`

This works, but the automation still depends too much on heuristics and client behavior. It can create low-value memories and cannot enforce identical lifecycle behavior across Claude and Codex.

### Validity

Current temporal support already exists in:

- `src/engine/temporal.ts`
- `src/storage/queries.ts`
- `src/storage/database.ts`

The missing piece is that validity is not yet a first-class input to all of:

- recall ranking
- sun context selection
- importance scoring
- automation decisions

## Shared Design Principle

Before changing scoring or automation, memories need a stronger lifecycle state.

Add a derived memory state model:

- `active`: currently valid and not superseded
- `superseded`: replaced by a newer memory
- `expired`: no longer valid due to `valid_until`
- `uncertain`: low confidence or not yet verified
- `archival`: intentionally retained historical knowledge

This does not need to be stored as a physical DB column first. It can begin as a derived helper from existing fields plus optional metadata.

## Track A: Adaptive Importance

### Objective

Move from a mostly static storage score to a score that reflects present usefulness.

### Proposed scoring model

Keep the current activation core, but add multiplicative or additive modifiers:

- `activationScore`: recency/frequency base
- `contentScore`: impact/content weight/quality
- `taskAlignmentScore`: overlap with current work, next steps, recent decisions, current file/topic
- `validityModifier`: penalty for superseded or expired memories
- `reuseModifier`: bonus when a memory repeatedly contributes to real work
- `scopeModifier`: universal vs project-local weighting depending on query context

Suggested composite shape:

`effectiveImportance = activationScore x contentScore x validityModifier x reuseModifier + taskAlignmentBonus`

### Code changes

- `src/engine/orbit.ts`
  - add helper to compute task alignment from sun state and query context
  - add validity-aware modifier layer
  - separate storage importance from retrieval importance more explicitly
- `src/engine/types.ts`
  - extend `ImportanceComponents` with task alignment, validity modifier, reuse modifier
- `src/utils/config.ts`
  - add tunable weights for task alignment and validity penalties

### Tests

- `tests/orbit.test.ts`
  - task-aligned memories rank above equally activated but irrelevant memories
  - superseded memories receive lower effective importance
  - expired memories drift outward even if historically important

## Track B: Smoother Automation

### Objective

Make automation quieter, denser, and less dependent on the client.

### Proposed automation policy

Introduce a two-stage automation gate:

1. `candidate extraction`
2. `memory worth storing` evaluation

Store only if the candidate passes one or more of:

- durable decision
- unresolved error with operational impact
- reusable workflow pattern
- milestone or architectural change
- explicit next-step commitment

Reject if mostly:

- conversational filler
- repeated weak restatements
- speculative statements without confirmation
- transient status with no future value

### Code changes

- `src/engine/observation.ts`
  - add a `shouldPersistObservation()` gate
  - add duplicate density filter before createMemory
  - distinguish `candidate`, `persisted`, `reinforced`, `conflicting`
- `src/engine/sun.ts`
  - make auto-commit prefer structured summaries over raw recent memory grouping
  - avoid overwriting recent manual commits with weaker auto-generated summaries
- `src/cli/init.ts`
  - keep Claude hooks and Codex guidance, but document a shared session policy contract

### Tests

- add a new `tests/observation.test.ts`
  - weak repeated chatter is filtered
  - durable decisions are retained
  - conflict candidates are surfaced without duplicating storage
- extend `tests/sun.test.ts`
  - auto-commit preserves stronger manual state
  - session summaries prefer active/current items over stale ones

## Track C: Stronger Validity Model

### Objective

Treat memory freshness and replacement as core system behavior rather than optional metadata.

### Proposed validity model

Use current fields first:

- `valid_from`
- `valid_until`
- `superseded_by`

Then add optional metadata conventions:

- `confidence`
- `verification_source`
- `state_reason`

Derived helper behavior:

- superseded beats active
- expired beats high importance
- uncertain memories can be recalled, but below active ones
- archival memories stay exportable and visible historically, but are de-prioritized for present work

### Code changes

- `src/engine/temporal.ts`
  - add helper like `getMemoryValidityState(memory, now)`
  - improve supersession detection beyond keyword overlap alone
- `src/storage/queries.ts`
  - ensure search/recall paths filter or demote invalid memories consistently
  - add helper queries for active-only vs historical retrieval
- `src/engine/sun.ts`
  - exclude superseded/expired memories from core sun sections by default

### Tests

- add `tests/temporal.test.ts`
  - active vs expired vs superseded classification
  - supersession chains remain stable
  - point-in-time queries still return historical knowledge correctly

## Integration Sequence

### Phase 1: Validity foundation

Deliverables:

- derived validity state helper
- query-level active filtering/demotion
- temporal tests

Reason:

Importance and automation should consume the same definition of current truth.

### Phase 2: Importance rewrite

Deliverables:

- task alignment modifier
- validity penalty integration
- expanded importance diagnostics
- orbit tests

Reason:

Once validity is real, importance can become context-aware without rewarding stale knowledge.

### Phase 3: Automation rewrite

Deliverables:

- observation persistence gate
- reduced noise in automatic memory creation
- stronger auto-commit summaries
- observation tests

Reason:

Automation should be the last consumer of the improved model, not the source of new ambiguity.

## Parallel Work Strategy

These can be worked on in parallel by separate agents if desired:

- Agent 1: temporal/validity helper + query semantics
- Agent 2: orbit scoring redesign + config surface
- Agent 3: observation/commit automation rewrite

But merge order should still be:

1. validity branch
2. importance branch rebased on validity
3. automation branch rebased on both

## Risks

- Over-correcting importance can hide historical but useful memories
- Over-filtering automation can reduce memory coverage too much
- Aggressive validity penalties can make long-lived architectural decisions disappear from the sun

Mitigations:

- keep explicit historical recall path
- expose scoring components in diagnostics
- add regression tests using realistic project memory sets

## Recommended Next Implementation Slice

Implement Phase 1 only:

- add derived validity state helper
- wire it into search/retrieval and sun selection
- add temporal tests

This gives the largest quality gain with the lowest regression risk and creates the foundation for the other two tracks.
