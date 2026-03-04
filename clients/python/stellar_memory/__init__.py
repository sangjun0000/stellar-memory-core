"""Stellar Memory Python SDK.

A client library for the Stellar Memory REST API — a persistent AI memory
system that uses celestial mechanics as a metaphor for memory importance.

Quick start::

    from stellar_memory import StellarMemory

    client = StellarMemory()  # connects to http://localhost:21547

    # Store a memory
    memory = client.remember(
        "Chose Redis over Memcached for its pub/sub support and persistence",
        type="decision",
        tags=["redis", "caching", "architecture"],
    )

    # Recall relevant memories
    results = client.recall("caching strategy")
    for m in results:
        print(m.summary, m.distance)

    # Commit session state to the Sun (long-term anchor)
    client.commit(
        current_work="Implementing caching layer",
        decisions=["Redis chosen over Memcached"],
        next_steps=["Add cache invalidation logic"],
    )

Async usage::

    import asyncio
    from stellar_memory import AsyncStellarMemory

    async def main():
        async with AsyncStellarMemory() as client:
            memory = await client.remember("Chose Redis", type="decision")
            results = await client.recall("Redis")

    asyncio.run(main())
"""

from .client import AsyncStellarMemory, StellarMemory
from .exceptions import (
    ConflictError,
    ConnectionError,
    NotFoundError,
    ServerError,
    StellarMemoryError,
    ValidationError,
)
from .types import (
    ConsolidationCandidate,
    ConstellationEdge,
    ConstellationGraph,
    DataSource,
    Memory,
    MemoryAnalytics,
    MemoryConflict,
    ObservationResult,
    OrbitChange,
    ProjectInfo,
    ScanResult,
    SunState,
    SystemStatus,
    ZoneStats,
)

__version__ = "0.1.0"
__all__ = [
    # Clients
    "StellarMemory",
    "AsyncStellarMemory",
    # Exceptions
    "StellarMemoryError",
    "ConnectionError",
    "NotFoundError",
    "ValidationError",
    "ConflictError",
    "ServerError",
    # Types
    "Memory",
    "SunState",
    "SystemStatus",
    "ZoneStats",
    "OrbitChange",
    "ConstellationEdge",
    "ConstellationGraph",
    "MemoryConflict",
    "MemoryAnalytics",
    "ProjectInfo",
    "ScanResult",
    "DataSource",
    "ObservationResult",
    "ConsolidationCandidate",
]
