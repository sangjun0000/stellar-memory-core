"""Dataclasses for Stellar Memory API types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


MemoryType = Literal[
    "decision", "observation", "task", "context", "error", "milestone", "procedural"
]

OrbitZone = Literal["core", "near", "active", "archive", "fading", "forgotten"]

RelationType = Literal[
    "uses", "caused_by", "part_of", "contradicts",
    "supersedes", "related_to", "depends_on", "derived_from",
]

ForgetMode = Literal["push", "delete"]


@dataclass
class Memory:
    """A single memory record stored in the Stellar Memory system."""

    id: str
    project: str
    content: str
    summary: str
    type: MemoryType
    tags: list[str]
    distance: float
    importance: float
    velocity: float
    impact: float
    access_count: int
    created_at: str
    updated_at: str
    last_accessed_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    source: str | None = None
    source_path: str | None = None
    source_hash: str | None = None
    content_hash: str | None = None
    deleted_at: str | None = None
    valid_from: str | None = None
    valid_until: str | None = None
    superseded_by: str | None = None
    consolidated_into: str | None = None
    quality_score: float | None = None
    is_universal: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Memory":
        return cls(
            id=data["id"],
            project=data["project"],
            content=data["content"],
            summary=data["summary"],
            type=data["type"],
            tags=data.get("tags") or [],
            distance=data["distance"],
            importance=data["importance"],
            velocity=data.get("velocity", 0.0),
            impact=data.get("impact", 0.5),
            access_count=data.get("access_count", 0),
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            last_accessed_at=data.get("last_accessed_at"),
            metadata=data.get("metadata") or {},
            source=data.get("source"),
            source_path=data.get("source_path"),
            source_hash=data.get("source_hash"),
            content_hash=data.get("content_hash"),
            deleted_at=data.get("deleted_at"),
            valid_from=data.get("valid_from"),
            valid_until=data.get("valid_until"),
            superseded_by=data.get("superseded_by"),
            consolidated_into=data.get("consolidated_into"),
            quality_score=data.get("quality_score"),
            is_universal=bool(data.get("is_universal", False)),
        )


@dataclass
class SunState:
    """The current working context committed to the Sun (long-term anchor)."""

    project: str
    content: str
    current_work: str
    recent_decisions: list[str]
    next_steps: list[str]
    active_errors: list[str]
    project_context: str
    token_count: int
    updated_at: str
    last_commit_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SunState":
        return cls(
            project=data["project"],
            content=data.get("content", ""),
            current_work=data.get("current_work", ""),
            recent_decisions=data.get("recent_decisions") or [],
            next_steps=data.get("next_steps") or [],
            active_errors=data.get("active_errors") or [],
            project_context=data.get("project_context", ""),
            token_count=data.get("token_count", 0),
            updated_at=data["updated_at"],
            last_commit_at=data.get("last_commit_at"),
        )


@dataclass
class ZoneStats:
    """Statistics for a single orbital zone."""

    zone: str
    label: str
    min_au: float
    max_au: float
    count: int
    avg_importance: float

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ZoneStats":
        return cls(
            zone=data["zone"],
            label=data["label"],
            min_au=data["min_au"],
            max_au=data["max_au"],
            count=data["count"],
            avg_importance=data.get("avg_importance", 0.0),
        )


@dataclass
class SystemStatus:
    """Overall status of the Stellar Memory system for a project."""

    project: str
    memory_count: int
    db_size_bytes: int
    db_path: str
    zone_breakdown: dict[str, int]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SystemStatus":
        return cls(
            project=data["project"],
            memory_count=data["memory_count"],
            db_size_bytes=data.get("db_size_bytes", 0),
            db_path=data.get("db_path", ""),
            zone_breakdown=data.get("zone_breakdown") or {},
        )


@dataclass
class OrbitChange:
    """Record of a memory's orbital position change."""

    memory_id: str
    project: str
    old_distance: float
    new_distance: float
    old_importance: float
    new_importance: float
    trigger: str
    id: int | None = None
    created_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "OrbitChange":
        return cls(
            id=data.get("id"),
            memory_id=data["memory_id"],
            project=data["project"],
            old_distance=data["old_distance"],
            new_distance=data["new_distance"],
            old_importance=data["old_importance"],
            new_importance=data["new_importance"],
            trigger=data["trigger"],
            created_at=data.get("created_at"),
        )


@dataclass
class ConstellationEdge:
    """A directed edge in the knowledge graph between two memories."""

    id: str
    source_id: str
    target_id: str
    relation: RelationType
    weight: float
    project: str
    created_at: str
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConstellationEdge":
        return cls(
            id=data["id"],
            source_id=data["source_id"],
            target_id=data["target_id"],
            relation=data["relation"],
            weight=data["weight"],
            project=data["project"],
            created_at=data["created_at"],
            metadata=data.get("metadata") or {},
        )


@dataclass
class ConstellationGraph:
    """A subgraph rooted at a memory, with related nodes and edges."""

    center_id: str
    nodes: list[Memory]
    edges: list[ConstellationEdge]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConstellationGraph":
        return cls(
            center_id=data.get("center_id", ""),
            nodes=[Memory.from_dict(n) for n in data.get("nodes", [])],
            edges=[ConstellationEdge.from_dict(e) for e in data.get("edges", [])],
        )


@dataclass
class MemoryConflict:
    """A detected conflict between two memories."""

    id: str
    memory_id: str
    conflicting_memory_id: str
    severity: Literal["high", "medium", "low"]
    description: str
    status: Literal["open", "resolved", "dismissed"]
    project: str
    created_at: str
    resolution: str | None = None
    resolved_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MemoryConflict":
        return cls(
            id=data["id"],
            memory_id=data["memory_id"],
            conflicting_memory_id=data["conflicting_memory_id"],
            severity=data["severity"],
            description=data["description"],
            status=data["status"],
            project=data["project"],
            created_at=data["created_at"],
            resolution=data.get("resolution"),
            resolved_at=data.get("resolved_at"),
        )


@dataclass
class MemoryAnalytics:
    """Aggregated analytics for a project's memory corpus."""

    total_memories: int
    zone_distribution: dict[str, int]
    type_distribution: dict[str, int]
    avg_quality: float
    avg_importance: float
    recall_success_rate: float
    consolidation_count: int
    conflict_count: int
    top_tags: list[dict[str, Any]]
    activity_timeline: list[dict[str, Any]]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MemoryAnalytics":
        return cls(
            total_memories=data.get("total_memories", 0),
            zone_distribution=data.get("zone_distribution") or {},
            type_distribution=data.get("type_distribution") or {},
            avg_quality=data.get("avg_quality", 0.0),
            avg_importance=data.get("avg_importance", 0.0),
            recall_success_rate=data.get("recall_success_rate", 0.0),
            consolidation_count=data.get("consolidation_count", 0),
            conflict_count=data.get("conflict_count", 0),
            top_tags=data.get("top_tags") or [],
            activity_timeline=data.get("activity_timeline") or [],
        )


@dataclass
class ProjectInfo:
    """Information about a single project."""

    name: str
    memory_count: int
    created_at: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ProjectInfo":
        return cls(
            name=data["name"],
            memory_count=data.get("memory_count", 0),
            created_at=data.get("created_at"),
        )


@dataclass
class ScanResult:
    """Result of a directory scan operation."""

    scanned_files: int
    created_memories: int
    skipped_files: int
    error_files: int
    duration_ms: int

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ScanResult":
        return cls(
            scanned_files=data.get("scannedFiles", 0),
            created_memories=data.get("createdMemories", 0),
            skipped_files=data.get("skippedFiles", 0),
            error_files=data.get("errorFiles", 0),
            duration_ms=data.get("durationMs", 0),
        )


@dataclass
class DataSource:
    """A registered data source (scan path)."""

    id: str
    path: str
    status: str
    last_scanned_at: str | None = None
    memory_count: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DataSource":
        return cls(
            id=data["id"],
            path=data["path"],
            status=data.get("status", "unknown"),
            last_scanned_at=data.get("last_scanned_at"),
            memory_count=data.get("memory_count", 0),
        )


@dataclass
class ObservationResult:
    """Result of processing a conversation for implicit memories."""

    memories_created: int
    memories_updated: int
    tags_extracted: list[str]
    project: str

    @classmethod
    def from_dict(cls, data: dict[str, Any], project: str = "default") -> "ObservationResult":
        return cls(
            memories_created=data.get("memories_created", data.get("memoriesCreated", 0)),
            memories_updated=data.get("memories_updated", data.get("memoriesUpdated", 0)),
            tags_extracted=data.get("tags_extracted") or data.get("tagsExtracted") or [],
            project=project,
        )


@dataclass
class ConsolidationCandidate:
    """A group of memories that are candidates for consolidation."""

    similarity: float
    memory_count: int
    memories: list[dict[str, Any]]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConsolidationCandidate":
        return cls(
            similarity=data["similarity"],
            memory_count=data.get("memoryCount", len(data.get("memories", []))),
            memories=data.get("memories") or [],
        )
