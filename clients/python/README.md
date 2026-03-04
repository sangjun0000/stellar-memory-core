# Stellar Memory — Python SDK

Python client for the [Stellar Memory](https://github.com/your-org/stellar-memory) REST API.
Supports both synchronous and asynchronous usage via [httpx](https://www.python-httpx.org/).

## Requirements

- Python 3.10+
- Stellar Memory API running on `localhost:21547` (`npm run api`)

## Installation

```bash
pip install stellar-memory
```

Or from source:

```bash
cd clients/python
pip install -e .
```

## Quick Start

```python
from stellar_memory import StellarMemory

client = StellarMemory()  # http://localhost:21547, project "default"

# Store a memory
memory = client.remember(
    "Chose PostgreSQL over MySQL for its superior JSON support",
    type="decision",
    tags=["database", "postgresql"],
    impact=0.8,
)

# Recall relevant memories
results = client.recall("database choice", limit=5)
for m in results:
    print(m.summary, f"({m.distance:.1f} AU)")

# Commit session context
client.commit(
    current_work="Setting up the database layer",
    decisions=["PostgreSQL chosen"],
    next_steps=["Write migrations", "Add connection pooling"],
)

client.close()
```

## Async Usage

```python
import asyncio
from stellar_memory import AsyncStellarMemory

async def main():
    async with AsyncStellarMemory(project="my-project") as stm:
        memory = await stm.remember("Redis for session storage", type="decision")
        results = await stm.recall("session storage", limit=5)
        await stm.commit(current_work="Implementing session layer")

asyncio.run(main())
```

## Client Options

Both `StellarMemory` and `AsyncStellarMemory` accept:

| Parameter  | Default                   | Description                        |
|------------|---------------------------|------------------------------------|
| `base_url` | `http://localhost:21547`  | API server URL                     |
| `project`  | `"default"`               | Default project for all operations |
| `timeout`  | `30.0`                    | Request timeout in seconds         |
| `headers`  | `{}`                      | Extra HTTP headers                 |

## API Reference

### Core Memory Operations

| Method | Description |
|--------|-------------|
| `remember(content, *, type, tags, impact, summary, project)` | Store a new memory |
| `recall(query, *, limit, type, zone, max_au, project)` | Hybrid search (FTS5 + vector) |
| `get_memory(memory_id)` | Fetch a memory by ID |
| `list_memories(*, zone, limit, summary_only, project)` | List all memories |
| `forget(memory_id, *, mode)` | Push to Oort cloud or soft-delete |
| `delete_memory(memory_id)` | Soft-delete (legacy) |
| `set_orbit(memory_id, distance)` | Manually adjust orbital distance |

### Memory Types

| Type | Default Impact | Use for |
|------|---------------|---------|
| `"decision"` | 0.8 | Architecture choices, technology selections |
| `"milestone"` | 0.7 | Completed features, achievements |
| `"error"` | 0.6 | Bugs found, outages, resolved issues |
| `"task"` | 0.5 | Work items, TODOs |
| `"context"` | 0.4 | Technical background, constraints |
| `"observation"` | 0.3 | Interesting patterns, notes |
| `"procedural"` | 0.5 | Behavioral patterns (auto-generated) |

### Orbital Zones

Memories drift away from the Sun based on importance:

| Zone | AU Range | Meaning |
|------|----------|---------|
| `"core"` | 0.1–1.0 | Instant recall — always visible |
| `"near"` | 1.0–5.0 | Recently accessed |
| `"active"` | 5.0–15.0 | In-context |
| `"archive"` | 15.0–40.0 | Older, but intact |
| `"fading"` | 40.0–70.0 | Losing relevance |
| `"forgotten"` | 70.0–100.0 | Oort cloud (soft-deleted) |

### Sun State

```python
# Get the persistent working context
sun = client.get_sun()
if sun:
    print(sun.current_work)
    print(sun.next_steps)

# Commit session state (call before ending every session)
sun = client.commit(
    current_work="What you're working on",
    decisions=["Decision A", "Decision B"],
    next_steps=["TODO 1", "TODO 2"],
    errors=["Unresolved blocker"],
    context="Tech stack, constraints, relevant background",
)
```

### System & Orbit

```python
# System status
status = client.status()
print(status.memory_count, status.zone_breakdown)

# Per-zone statistics
zones = client.zones()

# Trigger orbit recalculation (re-evaluates importance for all memories)
changes = client.orbit()

# Orbit history
history = client.orbit_history(limit=50, trigger="decay")
```

### Constellation (Knowledge Graph)

```python
# Get the knowledge graph around a memory
graph = client.constellation(memory_id, depth=2)
print(graph.nodes, graph.edges)

# Related memories sorted by edge weight
related = client.related_memories(memory_id, limit=10)

# Suggest new relationships
suggestions = client.suggest_relationships(memory_id)

# Re-extract relationships for an existing memory
edges = client.extract_relationships(memory_id)
```

### Projects

```python
# List all projects
projects = client.list_projects()

# Create a new project
client.create_project("new-project")

# Switch active project (also updates client.project)
client.switch_project("new-project")

# Universal memories (shared across all projects)
universal = client.universal_memories()
client.mark_universal(memory_id, is_universal=True)

# Project stats
stats = client.project_stats("my-project")
```

### Analytics

```python
analytics = client.analytics()
print(analytics.total_memories, analytics.type_distribution)

survival   = client.analytics_survival()
movements  = client.analytics_movements(days=30)
clusters   = client.analytics_clusters()
patterns   = client.analytics_patterns()
health     = client.analytics_health()
report     = client.analytics_report()  # plain text
```

### Temporal Awareness

```python
# Context as it existed at a point in time
past = client.temporal_at("2024-01-15T10:00:00Z")

# Evolution chain (how a memory changed over time)
chain = client.temporal_chain(memory_id)

# Set validity bounds
client.set_temporal_bounds(
    memory_id,
    valid_from="2024-01-01",
    valid_until="2024-12-31",
)

# Mark one memory as superseded by another
client.supersede_memory(old_id, new_id)

# Human-readable temporal summary
summary = client.temporal_summary()
```

### Conflicts

```python
# List unresolved conflicts
conflicts = client.conflicts()

# Conflicts for a specific memory
conflicts = client.conflicts_for_memory(memory_id)

# Resolve or dismiss
client.resolve_conflict(conflict_id, resolution="Kept the newer value", action="supersede")
client.dismiss_conflict(conflict_id, resolution="False positive")
```

### Observations

```python
# Auto-extract memories from a conversation
result = client.observe(conversation_text)
print(f"Created {result.memories_created} memories")

# List past observations
observations = client.list_observations(limit=20)
```

### Consolidation

```python
# Find redundant memory groups
candidates = client.consolidation_candidates()

# Run consolidation (merge redundant memories)
stats = client.consolidate()

# Source memories for a consolidated one
sources = client.consolidation_history(consolidated_id)
```

### Scanning

```python
# Scan a directory for content
result = client.scan("/path/to/project", recursive=True, git=True)
print(result.scanned_files, result.created_memories)

# Scan status and control
status = client.scan_status()
client.cancel_scan()

# Registered data sources
sources = client.list_sources()
```

## Error Handling

```python
from stellar_memory import (
    StellarMemory,
    ConnectionError,
    NotFoundError,
    ValidationError,
    ConflictError,
    ServerError,
    StellarMemoryError,
)

client = StellarMemory()

try:
    client.get_memory("nonexistent")
except NotFoundError:
    print("Memory not found")
except ConnectionError:
    print("API server is not running — start it with: npm run api")
except ValidationError as e:
    print(f"Bad request: {e}")
except ServerError as e:
    print(f"Server error {e.status_code}: {e}")
except StellarMemoryError as e:
    print(f"Unexpected error: {e}")
```

## Context Manager

Both clients support the context manager protocol:

```python
# Sync
with StellarMemory() as client:
    client.remember("something")

# Async
async with AsyncStellarMemory() as client:
    await client.remember("something")
```

## Examples

See the `examples/` directory:

- `basic_usage.py` — Core remember/recall/commit workflow
- `claude_integration.py` — Wrapping an AI agent with auto-memory and context injection
