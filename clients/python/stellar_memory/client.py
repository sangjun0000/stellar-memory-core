"""Stellar Memory Python client — synchronous and asynchronous."""

from __future__ import annotations

from typing import Any, Iterator, Literal

import httpx

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
    ForgetMode,
    MemoryAnalytics,
    MemoryConflict,
    MemoryType,
    Memory,
    ObservationResult,
    OrbitChange,
    OrbitZone,
    ProjectInfo,
    ScanResult,
    SunState,
    SystemStatus,
    ZoneStats,
)

DEFAULT_BASE_URL = "http://localhost:21547"
DEFAULT_TIMEOUT = 30.0


# ---------------------------------------------------------------------------
# Error handling helper
# ---------------------------------------------------------------------------


def _raise_for_response(response: httpx.Response) -> None:
    """Map HTTP error responses to typed exceptions."""
    if response.is_success:
        return

    try:
        body = response.json()
        message = body.get("error", response.text)
    except Exception:
        message = response.text or f"HTTP {response.status_code}"

    status = response.status_code
    if status == 404:
        raise NotFoundError(message)
    elif status == 409:
        raise ConflictError(message)
    elif status in (400, 422):
        raise ValidationError(message)
    elif status >= 500:
        raise ServerError(message, status_code=status)
    else:
        raise StellarMemoryError(message, status_code=status)


# ---------------------------------------------------------------------------
# Synchronous client
# ---------------------------------------------------------------------------


class StellarMemory:
    """Synchronous client for the Stellar Memory REST API.

    Example::

        client = StellarMemory()
        memory = client.remember("Chose Redis for caching because of its pub/sub support", type="decision")
        results = client.recall("caching strategy")
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        project: str = "default",
        timeout: float = DEFAULT_TIMEOUT,
        headers: dict[str, str] | None = None,
    ) -> None:
        """Create a synchronous Stellar Memory client.

        Args:
            base_url: Base URL of the Stellar Memory API server.
            project: Default project name for all operations.
            timeout: Request timeout in seconds.
            headers: Optional extra HTTP headers.
        """
        self.project = project
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout,
            headers=headers or {},
        )

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self) -> "StellarMemory":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        try:
            resp = self._client.get(path, params=_clean_params(params))
        except httpx.ConnectError as exc:
            raise ConnectionError(f"Cannot connect to Stellar Memory API: {exc}") from exc
        _raise_for_response(resp)
        return resp.json()

    def _post(self, path: str, json: Any = None, params: dict[str, Any] | None = None) -> Any:
        try:
            resp = self._client.post(path, json=json, params=_clean_params(params))
        except httpx.ConnectError as exc:
            raise ConnectionError(f"Cannot connect to Stellar Memory API: {exc}") from exc
        _raise_for_response(resp)
        return resp.json()

    def _patch(self, path: str, json: Any = None) -> Any:
        try:
            resp = self._client.patch(path, json=json)
        except httpx.ConnectError as exc:
            raise ConnectionError(f"Cannot connect to Stellar Memory API: {exc}") from exc
        _raise_for_response(resp)
        return resp.json()

    def _delete(self, path: str) -> Any:
        try:
            resp = self._client.delete(path)
        except httpx.ConnectError as exc:
            raise ConnectionError(f"Cannot connect to Stellar Memory API: {exc}") from exc
        _raise_for_response(resp)
        return resp.json()

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    def health(self) -> dict[str, Any]:
        """Check if the API server is reachable and healthy.

        Returns:
            Dict with ``name``, ``version``, and ``status`` keys.
        """
        return self._get("/api/health")

    # ------------------------------------------------------------------
    # Memories — core CRUD
    # ------------------------------------------------------------------

    def remember(
        self,
        content: str,
        *,
        type: MemoryType = "context",
        tags: list[str] | None = None,
        impact: float | None = None,
        summary: str | None = None,
        project: str | None = None,
    ) -> Memory:
        """Store a new memory.

        Args:
            content: The memory content to store.
            type: Memory type — one of ``decision``, ``observation``, ``task``,
                ``context``, ``error``, ``milestone``, ``procedural``.
            tags: Optional list of tag strings for searchability.
            impact: Override the default impact score (0.0–1.0).
            summary: Short one-line summary (auto-generated if omitted).
            project: Project name (uses client default if omitted).

        Returns:
            The newly created :class:`~stellar_memory.types.Memory`.
        """
        body: dict[str, Any] = {
            "content": content,
            "type": type,
            "project": project or self.project,
        }
        if tags is not None:
            body["tags"] = tags
        if impact is not None:
            body["impact"] = impact
        if summary is not None:
            body["summary"] = summary

        data = self._post("/api/memories", json=body)
        return Memory.from_dict(data["data"])

    def recall(
        self,
        query: str,
        *,
        limit: int = 10,
        type: MemoryType | Literal["all"] | None = None,
        zone: OrbitZone | None = None,
        max_au: float | None = None,
        project: str | None = None,
    ) -> list[Memory]:
        """Search memories using hybrid FTS5 + vector search.

        Args:
            query: Natural language query string.
            limit: Maximum number of results to return.
            type: Filter by memory type.
            zone: Filter by orbital zone.
            max_au: Exclude memories beyond this orbital distance (AU).
            project: Project name (uses client default if omitted).

        Returns:
            List of matching :class:`~stellar_memory.types.Memory` objects,
            ranked by relevance.
        """
        params: dict[str, Any] = {
            "q": query,
            "limit": limit,
            "project": project or self.project,
        }
        if type is not None:
            params["type"] = type
        if zone is not None:
            params["zone"] = zone
        if max_au is not None:
            params["max_au"] = max_au

        data = self._get("/api/memories/search", params=params)
        return [Memory.from_dict(m) for m in data.get("data", [])]

    def get_memory(self, memory_id: str) -> Memory:
        """Fetch a single memory by ID.

        Args:
            memory_id: Unique memory identifier.

        Returns:
            The :class:`~stellar_memory.types.Memory`.

        Raises:
            NotFoundError: If no memory with that ID exists.
        """
        data = self._get(f"/api/memories/{memory_id}")
        return Memory.from_dict(data["data"])

    def list_memories(
        self,
        *,
        zone: OrbitZone | None = None,
        limit: int | None = None,
        summary_only: bool = False,
        project: str | None = None,
    ) -> list[Memory]:
        """List all memories for a project, optionally filtered by zone.

        Args:
            zone: Filter by orbital zone.
            limit: Maximum number of results.
            summary_only: Return slim objects (id, summary, type, distance, importance).
            project: Project name (uses client default if omitted).

        Returns:
            List of :class:`~stellar_memory.types.Memory` objects.
        """
        params: dict[str, Any] = {"project": project or self.project}
        if zone is not None:
            params["zone"] = zone
        if limit is not None:
            params["limit"] = limit
        if summary_only:
            params["summary_only"] = "true"

        data = self._get("/api/memories", params=params)
        return [Memory.from_dict(m) for m in data.get("data", [])]

    def forget(
        self,
        memory_id: str,
        *,
        mode: ForgetMode = "push",
    ) -> bool:
        """Forget a memory by pushing it to the outer Oort cloud or soft-deleting it.

        Args:
            memory_id: Unique memory identifier.
            mode: ``"push"`` moves the memory to the Forgotten zone (still searchable);
                ``"delete"`` soft-deletes it from all queries.

        Returns:
            ``True`` on success.

        Raises:
            NotFoundError: If no memory with that ID exists.
        """
        self._post(f"/api/memories/{memory_id}/forget", json={"mode": mode})
        return True

    def delete_memory(self, memory_id: str) -> bool:
        """Soft-delete a memory (legacy endpoint).

        Prefer :meth:`forget` with ``mode="delete"`` for new code.

        Args:
            memory_id: Unique memory identifier.

        Returns:
            ``True`` on success.
        """
        self._delete(f"/api/memories/{memory_id}")
        return True

    def set_orbit(self, memory_id: str, distance: float) -> dict[str, Any]:
        """Manually set a memory's orbital distance.

        Args:
            memory_id: Unique memory identifier.
            distance: New orbital distance in AU (0.1–100).

        Returns:
            Dict with ``id``, ``old_distance``, ``new_distance``,
            ``old_importance``, and ``new_importance``.
        """
        data = self._patch(f"/api/memories/{memory_id}/orbit", json={"distance": distance})
        return data["data"]

    # ------------------------------------------------------------------
    # Sun state
    # ------------------------------------------------------------------

    def get_sun(self, *, project: str | None = None) -> SunState | None:
        """Fetch the current working context anchored to the Sun.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            :class:`~stellar_memory.types.SunState` or ``None`` if not yet committed.
        """
        data = self._get("/api/sun", params={"project": project or self.project})
        raw = data.get("data")
        return SunState.from_dict(raw) if raw else None

    def commit(
        self,
        current_work: str,
        *,
        decisions: list[str] | None = None,
        next_steps: list[str] | None = None,
        errors: list[str] | None = None,
        context: str | None = None,
        project: str | None = None,
    ) -> SunState:
        """Commit the current session state to the Sun anchor.

        This is the most important memory operation — it preserves working
        context across sessions so the next session starts with full awareness.

        Args:
            current_work: Description of what is currently being worked on.
            decisions: List of decisions made in this session.
            next_steps: Concrete actions planned for the next session.
            errors: Unresolved errors or blockers.
            context: Free-form technical context or constraints.
            project: Project name (uses client default if omitted).

        Returns:
            Updated :class:`~stellar_memory.types.SunState`.
        """
        body: dict[str, Any] = {
            "current_work": current_work,
            "project": project or self.project,
            "decisions": decisions or [],
            "next_steps": next_steps or [],
            "errors": errors or [],
        }
        if context is not None:
            body["context"] = context

        data = self._post("/api/sun/commit", json=body)
        return SunState.from_dict(data["data"])

    # ------------------------------------------------------------------
    # System
    # ------------------------------------------------------------------

    def status(self, *, project: str | None = None) -> SystemStatus:
        """Get the overall system status for a project.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            :class:`~stellar_memory.types.SystemStatus`.
        """
        data = self._get("/api/system/status", params={"project": project or self.project})
        return SystemStatus.from_dict(data["data"])

    def zones(self, *, project: str | None = None) -> list[ZoneStats]:
        """Get per-zone statistics.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            List of :class:`~stellar_memory.types.ZoneStats`.
        """
        data = self._get("/api/system/zones", params={"project": project or self.project})
        return [ZoneStats.from_dict(z) for z in data.get("data", [])]

    # ------------------------------------------------------------------
    # Orbit
    # ------------------------------------------------------------------

    def orbit(self, *, project: str | None = None) -> list[OrbitChange]:
        """Trigger a full orbit recalculation for a project.

        Recalculates importance and distance for all memories based on
        recency decay, access frequency, and impact scores.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            List of :class:`~stellar_memory.types.OrbitChange` records.
        """
        data = self._post("/api/orbit", params={"project": project or self.project})
        return [OrbitChange.from_dict(c) for c in data.get("data", [])]

    def orbit_history(
        self,
        *,
        limit: int = 50,
        trigger: str | None = None,
        project: str | None = None,
    ) -> list[OrbitChange]:
        """Fetch recent orbit log entries.

        Args:
            limit: Maximum number of entries to return (max 200).
            trigger: Filter by trigger type (``"decay"``, ``"access"``, ``"forget"``).
            project: Project name (uses client default if omitted).

        Returns:
            List of :class:`~stellar_memory.types.OrbitChange` records.
        """
        params: dict[str, Any] = {
            "project": project or self.project,
            "limit": limit,
        }
        if trigger is not None:
            params["trigger"] = trigger

        data = self._get("/api/orbit/history", params=params)
        return [OrbitChange.from_dict(c) for c in data.get("data", [])]

    # ------------------------------------------------------------------
    # Constellation (knowledge graph)
    # ------------------------------------------------------------------

    def constellation(
        self,
        memory_id: str,
        *,
        depth: int = 1,
        project: str | None = None,
    ) -> ConstellationGraph:
        """Fetch the knowledge graph rooted at a memory.

        Args:
            memory_id: Unique memory identifier.
            depth: Graph traversal depth (1–3).
            project: Project name (uses client default if omitted).

        Returns:
            :class:`~stellar_memory.types.ConstellationGraph`.
        """
        params: dict[str, Any] = {"project": project or self.project, "depth": depth}
        data = self._get(f"/api/constellation/{memory_id}", params=params)
        return ConstellationGraph.from_dict(data["data"])

    def related_memories(
        self,
        memory_id: str,
        *,
        limit: int = 10,
        project: str | None = None,
    ) -> list[Memory]:
        """Get memories related to a given memory, sorted by edge weight.

        Args:
            memory_id: Unique memory identifier.
            limit: Maximum number of related memories.
            project: Project name (uses client default if omitted).

        Returns:
            List of :class:`~stellar_memory.types.Memory` objects.
        """
        params: dict[str, Any] = {"project": project or self.project, "limit": limit}
        data = self._get(f"/api/constellation/{memory_id}/related", params=params)
        return [Memory.from_dict(m) for m in data.get("data", [])]

    def suggest_relationships(
        self,
        memory_id: str,
        *,
        project: str | None = None,
    ) -> list[dict[str, Any]]:
        """Suggest potential new relationships for a memory.

        Args:
            memory_id: Unique memory identifier.
            project: Project name (uses client default if omitted).

        Returns:
            List of relationship suggestion dicts.
        """
        params: dict[str, Any] = {"project": project or self.project}
        data = self._get(f"/api/constellation/{memory_id}/suggest", params=params)
        return data.get("data", [])

    def extract_relationships(
        self,
        memory_id: str,
        *,
        project: str | None = None,
    ) -> list[ConstellationEdge]:
        """Trigger relationship extraction for a memory.

        Useful for reprocessing existing memories created before the
        constellation system was active.

        Args:
            memory_id: Unique memory identifier.
            project: Project name (uses client default if omitted).

        Returns:
            List of extracted :class:`~stellar_memory.types.ConstellationEdge` objects.
        """
        data = self._post(
            f"/api/constellation/{memory_id}/extract",
            params={"project": project or self.project},
        )
        return [ConstellationEdge.from_dict(e) for e in data.get("data", [])]

    def delete_constellation(self, memory_id: str) -> bool:
        """Remove all constellation edges for a memory.

        Args:
            memory_id: Unique memory identifier.

        Returns:
            ``True`` on success.
        """
        self._delete(f"/api/constellation/{memory_id}")
        return True

    # ------------------------------------------------------------------
    # Projects
    # ------------------------------------------------------------------

    def list_projects(self) -> list[ProjectInfo]:
        """List all projects with memory counts.

        Returns:
            List of :class:`~stellar_memory.types.ProjectInfo` objects.
        """
        data = self._get("/api/projects")
        return [ProjectInfo.from_dict(p) for p in data.get("data", [])]

    def create_project(self, name: str) -> dict[str, Any]:
        """Create a new project.

        Args:
            name: Project name.

        Returns:
            Dict with ``name`` and ``created`` keys.
        """
        data = self._post("/api/projects", json={"name": name})
        return data["data"]

    def switch_project(self, project: str) -> dict[str, Any]:
        """Switch the active project at runtime.

        Args:
            project: Name of the project to switch to.

        Returns:
            Result dict from the server.
        """
        data = self._post("/api/projects/switch", json={"project": project})
        self.project = project
        return data["data"]

    def universal_memories(self, *, limit: int = 50) -> list[Memory]:
        """List all universal memories (shared across all projects).

        Args:
            limit: Maximum number of memories to return.

        Returns:
            List of :class:`~stellar_memory.types.Memory` objects.
        """
        data = self._get("/api/projects/universal", params={"limit": limit})
        return [Memory.from_dict(m) for m in data.get("data", [])]

    def mark_universal(self, memory_id: str, *, is_universal: bool = True) -> bool:
        """Mark or unmark a memory as universal (shared across projects).

        Args:
            memory_id: Unique memory identifier.
            is_universal: ``True`` to mark as universal, ``False`` to unmark.

        Returns:
            ``True`` on success.
        """
        self._post(f"/api/projects/universal/{memory_id}", json={"is_universal": is_universal})
        return True

    def project_stats(self, project: str) -> dict[str, Any]:
        """Get detailed statistics for a specific project.

        Args:
            project: Project name.

        Returns:
            Stats dict from the server.
        """
        data = self._get(f"/api/projects/{project}/stats")
        return data["data"]

    def universal_context(self, project: str, *, limit: int = 20) -> list[Memory]:
        """Get universal memories relevant to a project.

        Args:
            project: Project name.
            limit: Maximum number of memories.

        Returns:
            List of :class:`~stellar_memory.types.Memory` objects.
        """
        data = self._get(f"/api/projects/{project}/universal", params={"limit": limit})
        return [Memory.from_dict(m) for m in data.get("data", [])]

    def universal_candidates(self, project: str) -> list[Memory]:
        """Detect memories that are candidates for promotion to universal.

        Args:
            project: Project name.

        Returns:
            List of candidate :class:`~stellar_memory.types.Memory` objects.
        """
        data = self._get(f"/api/projects/{project}/candidates")
        return [Memory.from_dict(m) for m in data.get("data", [])]

    # ------------------------------------------------------------------
    # Analytics
    # ------------------------------------------------------------------

    def analytics(self, *, project: str | None = None) -> MemoryAnalytics:
        """Get a full analytics overview for a project.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            :class:`~stellar_memory.types.MemoryAnalytics`.
        """
        data = self._get("/api/analytics/overview", params={"project": project or self.project})
        return MemoryAnalytics.from_dict(data["data"])

    def analytics_survival(self, *, project: str | None = None) -> list[dict[str, Any]]:
        """Get survival curve data (memory retention by age bucket).

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            List of age-bucket dicts.
        """
        data = self._get("/api/analytics/survival", params={"project": project or self.project})
        return data.get("data", [])

    def analytics_movements(
        self, *, days: int = 30, project: str | None = None
    ) -> list[dict[str, Any]]:
        """Get orbital movement timeline data.

        Args:
            days: Number of days to look back.
            project: Project name (uses client default if omitted).

        Returns:
            List of movement records.
        """
        params = {"project": project or self.project, "days": days}
        data = self._get("/api/analytics/movements", params=params)
        return data.get("data", [])

    def analytics_clusters(self, *, project: str | None = None) -> list[dict[str, Any]]:
        """Get topic cluster heatmap data.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            List of cluster dicts.
        """
        data = self._get("/api/analytics/clusters", params={"project": project or self.project})
        return data.get("data", [])

    def analytics_patterns(self, *, project: str | None = None) -> list[dict[str, Any]]:
        """Detect periodic access patterns.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            List of pattern dicts.
        """
        data = self._get("/api/analytics/patterns", params={"project": project or self.project})
        return data.get("data", [])

    def analytics_health(self, *, project: str | None = None) -> dict[str, Any]:
        """Get memory health metrics and recommendations.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            Health metrics dict.
        """
        data = self._get("/api/analytics/health", params={"project": project or self.project})
        return data.get("data", {})

    def analytics_report(self, *, project: str | None = None) -> str:
        """Generate a full text analytics report.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            Report as a plain text string.
        """
        data = self._get("/api/analytics/report", params={"project": project or self.project})
        return data.get("data", "")

    # ------------------------------------------------------------------
    # Temporal
    # ------------------------------------------------------------------

    def temporal_at(self, timestamp: str, *, project: str | None = None) -> list[Memory]:
        """Get the memory context as it existed at a specific point in time.

        Args:
            timestamp: ISO 8601 timestamp string.
            project: Project name (uses client default if omitted).

        Returns:
            List of :class:`~stellar_memory.types.Memory` objects valid at that time.
        """
        params = {"timestamp": timestamp, "project": project or self.project}
        data = self._get("/api/temporal/at", params=params)
        return [Memory.from_dict(m) for m in data.get("data", [])]

    def temporal_chain(self, memory_id: str) -> list[Memory]:
        """Get the evolution chain of a memory (how it changed over time).

        Args:
            memory_id: Unique memory identifier.

        Returns:
            List of :class:`~stellar_memory.types.Memory` objects in chronological order.
        """
        data = self._get(f"/api/temporal/chain/{memory_id}")
        return [Memory.from_dict(m) for m in data.get("data", [])]

    def temporal_summary(self, *, project: str | None = None) -> str:
        """Get a human-readable temporal summary for a project.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            Summary string.
        """
        data = self._get("/api/temporal/summary", params={"project": project or self.project})
        return data.get("data", "")

    def set_temporal_bounds(
        self,
        memory_id: str,
        *,
        valid_from: str | None = None,
        valid_until: str | None = None,
    ) -> bool:
        """Set the temporal validity bounds for a memory.

        Args:
            memory_id: Unique memory identifier.
            valid_from: ISO 8601 date when this fact became true.
            valid_until: ISO 8601 date when this fact stopped being true.

        Returns:
            ``True`` on success.
        """
        body: dict[str, Any] = {}
        if valid_from is not None:
            body["valid_from"] = valid_from
        if valid_until is not None:
            body["valid_until"] = valid_until
        self._post(f"/api/temporal/bounds/{memory_id}", json=body)
        return True

    def supersede_memory(self, old_id: str, new_id: str) -> bool:
        """Mark one memory as superseded by another.

        Args:
            old_id: Memory ID that is being replaced.
            new_id: Memory ID that replaces it.

        Returns:
            ``True`` on success.
        """
        self._post("/api/temporal/supersede", json={"oldId": old_id, "newId": new_id})
        return True

    # ------------------------------------------------------------------
    # Conflicts
    # ------------------------------------------------------------------

    def conflicts(self, *, project: str | None = None) -> list[MemoryConflict]:
        """List all unresolved memory conflicts for a project.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            List of :class:`~stellar_memory.types.MemoryConflict` objects.
        """
        data = self._get("/api/conflicts", params={"project": project or self.project})
        return [MemoryConflict.from_dict(c) for c in data.get("data", [])]

    def conflicts_for_memory(self, memory_id: str) -> list[MemoryConflict]:
        """Get all conflicts involving a specific memory.

        Args:
            memory_id: Unique memory identifier.

        Returns:
            List of :class:`~stellar_memory.types.MemoryConflict` objects.
        """
        data = self._get(f"/api/conflicts/{memory_id}")
        return [MemoryConflict.from_dict(c) for c in data.get("data", [])]

    def resolve_conflict(
        self,
        conflict_id: str,
        *,
        resolution: str = "Resolved",
        action: Literal["supersede", "dismiss", "keep_both"] = "supersede",
    ) -> bool:
        """Resolve a memory conflict.

        Args:
            conflict_id: Unique conflict identifier.
            resolution: Human-readable description of how it was resolved.
            action: Resolution strategy — ``"supersede"``, ``"dismiss"``, or ``"keep_both"``.

        Returns:
            ``True`` on success.
        """
        body = {"resolution": resolution, "action": action}
        self._post(f"/api/conflicts/{conflict_id}/resolve", json=body)
        return True

    def dismiss_conflict(self, conflict_id: str, *, resolution: str = "Dismissed") -> bool:
        """Dismiss a memory conflict without resolving it.

        Args:
            conflict_id: Unique conflict identifier.
            resolution: Optional reason for dismissal.

        Returns:
            ``True`` on success.
        """
        self._post(f"/api/conflicts/{conflict_id}/dismiss", json={"resolution": resolution})
        return True

    # ------------------------------------------------------------------
    # Observations
    # ------------------------------------------------------------------

    def observe(
        self,
        conversation: str,
        *,
        project: str | None = None,
    ) -> ObservationResult:
        """Process a conversation text to extract and store implicit memories.

        The server analyzes the conversation for facts, decisions, errors,
        and other memorable content, then creates memories automatically.

        Args:
            conversation: Raw conversation or text to analyze.
            project: Project name (uses client default if omitted).

        Returns:
            :class:`~stellar_memory.types.ObservationResult` with counts of
            created/updated memories.
        """
        proj = project or self.project
        data = self._post(
            "/api/observations/process",
            json={"conversation": conversation, "project": proj},
        )
        return ObservationResult.from_dict(data.get("data", {}), project=proj)

    def list_observations(
        self,
        *,
        limit: int = 20,
        project: str | None = None,
    ) -> list[dict[str, Any]]:
        """List observation log entries for a project.

        Args:
            limit: Maximum number of entries.
            project: Project name (uses client default if omitted).

        Returns:
            List of observation dicts.
        """
        params = {"project": project or self.project, "limit": limit}
        data = self._get("/api/observations", params=params)
        return data.get("data", [])

    # ------------------------------------------------------------------
    # Consolidation
    # ------------------------------------------------------------------

    def consolidation_candidates(
        self, *, project: str | None = None
    ) -> list[ConsolidationCandidate]:
        """Find groups of memories that are candidates for consolidation.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            List of :class:`~stellar_memory.types.ConsolidationCandidate` objects.
        """
        data = self._get(
            "/api/consolidation/candidates",
            params={"project": project or self.project},
        )
        return [ConsolidationCandidate.from_dict(c) for c in data.get("data", [])]

    def consolidate(self, *, project: str | None = None) -> dict[str, Any]:
        """Run consolidation to merge redundant memories.

        Args:
            project: Project name (uses client default if omitted).

        Returns:
            Stats dict with ``merged``, ``skipped``, etc.
        """
        data = self._post("/api/consolidation/run", json={"project": project or self.project})
        return data.get("data", {})

    def consolidation_history(self, consolidated_id: str) -> list[Memory]:
        """Get source memories that were merged into a consolidated memory.

        Args:
            consolidated_id: ID of the consolidated (merged) memory.

        Returns:
            List of source :class:`~stellar_memory.types.Memory` objects.
        """
        data = self._get(f"/api/consolidation/history/{consolidated_id}")
        return [Memory.from_dict(m) for m in data.get("data", [])]

    # ------------------------------------------------------------------
    # Scan
    # ------------------------------------------------------------------

    def scan(
        self,
        path: str,
        *,
        recursive: bool = True,
        git: bool = True,
        max_kb: int | None = None,
    ) -> ScanResult:
        """Trigger a one-shot directory scan.

        Args:
            path: Absolute directory path to scan.
            recursive: Whether to scan subdirectories.
            git: Whether to include git history in the scan.
            max_kb: Maximum file size to scan in kilobytes.

        Returns:
            :class:`~stellar_memory.types.ScanResult`.
        """
        body: dict[str, Any] = {"path": path, "recursive": recursive, "git": git}
        if max_kb is not None:
            body["max_kb"] = max_kb

        data = self._post("/api/scan", json=body)
        return ScanResult.from_dict(data.get("data", {}))

    def scan_status(self) -> dict[str, Any]:
        """Check if a scan is currently in progress.

        Returns:
            Dict with ``isScanning`` bool and optional ``progress`` info.
        """
        data = self._get("/api/scan/status")
        return data.get("data", {})

    def cancel_scan(self) -> bool:
        """Cancel a scan that is currently in progress.

        Returns:
            ``True`` on success.

        Raises:
            NotFoundError: If no scan is in progress.
        """
        self._post("/api/scan/cancel")
        return True

    def list_sources(self) -> list[DataSource]:
        """List all registered data sources.

        Returns:
            List of :class:`~stellar_memory.types.DataSource` objects.
        """
        data = self._get("/api/sources")
        return [DataSource.from_dict(s) for s in data.get("data", [])]


# ---------------------------------------------------------------------------
# Async client
# ---------------------------------------------------------------------------


class AsyncStellarMemory:
    """Asynchronous client for the Stellar Memory REST API.

    Example::

        async with AsyncStellarMemory() as client:
            memory = await client.remember("Redis chosen for caching", type="decision")
            results = await client.recall("caching")
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        project: str = "default",
        timeout: float = DEFAULT_TIMEOUT,
        headers: dict[str, str] | None = None,
    ) -> None:
        """Create an asynchronous Stellar Memory client.

        Args:
            base_url: Base URL of the Stellar Memory API server.
            project: Default project name for all operations.
            timeout: Request timeout in seconds.
            headers: Optional extra HTTP headers.
        """
        self.project = project
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout,
            headers=headers or {},
        )

    async def aclose(self) -> None:
        """Close the underlying async HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> "AsyncStellarMemory":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        try:
            resp = await self._client.get(path, params=_clean_params(params))
        except httpx.ConnectError as exc:
            raise ConnectionError(f"Cannot connect to Stellar Memory API: {exc}") from exc
        _raise_for_response(resp)
        return resp.json()

    async def _post(self, path: str, json: Any = None, params: dict[str, Any] | None = None) -> Any:
        try:
            resp = await self._client.post(path, json=json, params=_clean_params(params))
        except httpx.ConnectError as exc:
            raise ConnectionError(f"Cannot connect to Stellar Memory API: {exc}") from exc
        _raise_for_response(resp)
        return resp.json()

    async def _patch(self, path: str, json: Any = None) -> Any:
        try:
            resp = await self._client.patch(path, json=json)
        except httpx.ConnectError as exc:
            raise ConnectionError(f"Cannot connect to Stellar Memory API: {exc}") from exc
        _raise_for_response(resp)
        return resp.json()

    async def _delete(self, path: str) -> Any:
        try:
            resp = await self._client.delete(path)
        except httpx.ConnectError as exc:
            raise ConnectionError(f"Cannot connect to Stellar Memory API: {exc}") from exc
        _raise_for_response(resp)
        return resp.json()

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    async def health(self) -> dict[str, Any]:
        """Check if the API server is reachable and healthy."""
        return await self._get("/api/health")

    # ------------------------------------------------------------------
    # Memories
    # ------------------------------------------------------------------

    async def remember(
        self,
        content: str,
        *,
        type: MemoryType = "context",
        tags: list[str] | None = None,
        impact: float | None = None,
        summary: str | None = None,
        project: str | None = None,
    ) -> Memory:
        """Store a new memory asynchronously.

        Args:
            content: The memory content to store.
            type: Memory type.
            tags: Optional list of tag strings.
            impact: Override impact score (0.0–1.0).
            summary: Short summary (auto-generated if omitted).
            project: Project name (uses client default if omitted).

        Returns:
            The newly created :class:`~stellar_memory.types.Memory`.
        """
        body: dict[str, Any] = {
            "content": content,
            "type": type,
            "project": project or self.project,
        }
        if tags is not None:
            body["tags"] = tags
        if impact is not None:
            body["impact"] = impact
        if summary is not None:
            body["summary"] = summary

        data = await self._post("/api/memories", json=body)
        return Memory.from_dict(data["data"])

    async def recall(
        self,
        query: str,
        *,
        limit: int = 10,
        type: MemoryType | Literal["all"] | None = None,
        zone: OrbitZone | None = None,
        max_au: float | None = None,
        project: str | None = None,
    ) -> list[Memory]:
        """Search memories using hybrid FTS5 + vector search asynchronously.

        Args:
            query: Natural language query string.
            limit: Maximum number of results.
            type: Filter by memory type.
            zone: Filter by orbital zone.
            max_au: Exclude memories beyond this distance.
            project: Project name (uses client default if omitted).

        Returns:
            List of :class:`~stellar_memory.types.Memory` objects.
        """
        params: dict[str, Any] = {
            "q": query,
            "limit": limit,
            "project": project or self.project,
        }
        if type is not None:
            params["type"] = type
        if zone is not None:
            params["zone"] = zone
        if max_au is not None:
            params["max_au"] = max_au

        data = await self._get("/api/memories/search", params=params)
        return [Memory.from_dict(m) for m in data.get("data", [])]

    async def get_memory(self, memory_id: str) -> Memory:
        """Fetch a single memory by ID asynchronously."""
        data = await self._get(f"/api/memories/{memory_id}")
        return Memory.from_dict(data["data"])

    async def list_memories(
        self,
        *,
        zone: OrbitZone | None = None,
        limit: int | None = None,
        summary_only: bool = False,
        project: str | None = None,
    ) -> list[Memory]:
        """List all memories for a project asynchronously."""
        params: dict[str, Any] = {"project": project or self.project}
        if zone is not None:
            params["zone"] = zone
        if limit is not None:
            params["limit"] = limit
        if summary_only:
            params["summary_only"] = "true"

        data = await self._get("/api/memories", params=params)
        return [Memory.from_dict(m) for m in data.get("data", [])]

    async def forget(self, memory_id: str, *, mode: ForgetMode = "push") -> bool:
        """Forget a memory asynchronously."""
        await self._post(f"/api/memories/{memory_id}/forget", json={"mode": mode})
        return True

    async def delete_memory(self, memory_id: str) -> bool:
        """Soft-delete a memory asynchronously."""
        await self._delete(f"/api/memories/{memory_id}")
        return True

    async def set_orbit(self, memory_id: str, distance: float) -> dict[str, Any]:
        """Manually set a memory's orbital distance asynchronously."""
        data = await self._patch(f"/api/memories/{memory_id}/orbit", json={"distance": distance})
        return data["data"]

    # ------------------------------------------------------------------
    # Sun state
    # ------------------------------------------------------------------

    async def get_sun(self, *, project: str | None = None) -> SunState | None:
        """Fetch the current Sun state asynchronously."""
        data = await self._get("/api/sun", params={"project": project or self.project})
        raw = data.get("data")
        return SunState.from_dict(raw) if raw else None

    async def commit(
        self,
        current_work: str,
        *,
        decisions: list[str] | None = None,
        next_steps: list[str] | None = None,
        errors: list[str] | None = None,
        context: str | None = None,
        project: str | None = None,
    ) -> SunState:
        """Commit session state to the Sun anchor asynchronously."""
        body: dict[str, Any] = {
            "current_work": current_work,
            "project": project or self.project,
            "decisions": decisions or [],
            "next_steps": next_steps or [],
            "errors": errors or [],
        }
        if context is not None:
            body["context"] = context

        data = await self._post("/api/sun/commit", json=body)
        return SunState.from_dict(data["data"])

    # ------------------------------------------------------------------
    # System
    # ------------------------------------------------------------------

    async def status(self, *, project: str | None = None) -> SystemStatus:
        """Get system status asynchronously."""
        data = await self._get("/api/system/status", params={"project": project or self.project})
        return SystemStatus.from_dict(data["data"])

    async def zones(self, *, project: str | None = None) -> list[ZoneStats]:
        """Get per-zone statistics asynchronously."""
        data = await self._get("/api/system/zones", params={"project": project or self.project})
        return [ZoneStats.from_dict(z) for z in data.get("data", [])]

    # ------------------------------------------------------------------
    # Orbit
    # ------------------------------------------------------------------

    async def orbit(self, *, project: str | None = None) -> list[OrbitChange]:
        """Trigger orbit recalculation asynchronously."""
        data = await self._post("/api/orbit", params={"project": project or self.project})
        return [OrbitChange.from_dict(c) for c in data.get("data", [])]

    async def orbit_history(
        self,
        *,
        limit: int = 50,
        trigger: str | None = None,
        project: str | None = None,
    ) -> list[OrbitChange]:
        """Fetch orbit history asynchronously."""
        params: dict[str, Any] = {"project": project or self.project, "limit": limit}
        if trigger is not None:
            params["trigger"] = trigger

        data = await self._get("/api/orbit/history", params=params)
        return [OrbitChange.from_dict(c) for c in data.get("data", [])]

    # ------------------------------------------------------------------
    # Constellation
    # ------------------------------------------------------------------

    async def constellation(
        self, memory_id: str, *, depth: int = 1, project: str | None = None
    ) -> ConstellationGraph:
        """Fetch constellation graph asynchronously."""
        params: dict[str, Any] = {"project": project or self.project, "depth": depth}
        data = await self._get(f"/api/constellation/{memory_id}", params=params)
        return ConstellationGraph.from_dict(data["data"])

    async def related_memories(
        self, memory_id: str, *, limit: int = 10, project: str | None = None
    ) -> list[Memory]:
        """Get related memories asynchronously."""
        params: dict[str, Any] = {"project": project or self.project, "limit": limit}
        data = await self._get(f"/api/constellation/{memory_id}/related", params=params)
        return [Memory.from_dict(m) for m in data.get("data", [])]

    async def suggest_relationships(
        self, memory_id: str, *, project: str | None = None
    ) -> list[dict[str, Any]]:
        """Suggest relationships asynchronously."""
        params: dict[str, Any] = {"project": project or self.project}
        data = await self._get(f"/api/constellation/{memory_id}/suggest", params=params)
        return data.get("data", [])

    async def extract_relationships(
        self, memory_id: str, *, project: str | None = None
    ) -> list[ConstellationEdge]:
        """Extract relationships asynchronously."""
        data = await self._post(
            f"/api/constellation/{memory_id}/extract",
            params={"project": project or self.project},
        )
        return [ConstellationEdge.from_dict(e) for e in data.get("data", [])]

    async def delete_constellation(self, memory_id: str) -> bool:
        """Remove constellation edges asynchronously."""
        await self._delete(f"/api/constellation/{memory_id}")
        return True

    # ------------------------------------------------------------------
    # Projects
    # ------------------------------------------------------------------

    async def list_projects(self) -> list[ProjectInfo]:
        """List projects asynchronously."""
        data = await self._get("/api/projects")
        return [ProjectInfo.from_dict(p) for p in data.get("data", [])]

    async def create_project(self, name: str) -> dict[str, Any]:
        """Create a project asynchronously."""
        data = await self._post("/api/projects", json={"name": name})
        return data["data"]

    async def switch_project(self, project: str) -> dict[str, Any]:
        """Switch active project asynchronously."""
        data = await self._post("/api/projects/switch", json={"project": project})
        self.project = project
        return data["data"]

    async def universal_memories(self, *, limit: int = 50) -> list[Memory]:
        """List universal memories asynchronously."""
        data = await self._get("/api/projects/universal", params={"limit": limit})
        return [Memory.from_dict(m) for m in data.get("data", [])]

    async def mark_universal(self, memory_id: str, *, is_universal: bool = True) -> bool:
        """Mark memory as universal asynchronously."""
        await self._post(f"/api/projects/universal/{memory_id}", json={"is_universal": is_universal})
        return True

    async def project_stats(self, project: str) -> dict[str, Any]:
        """Get project stats asynchronously."""
        data = await self._get(f"/api/projects/{project}/stats")
        return data["data"]

    async def universal_context(self, project: str, *, limit: int = 20) -> list[Memory]:
        """Get universal context memories asynchronously."""
        data = await self._get(f"/api/projects/{project}/universal", params={"limit": limit})
        return [Memory.from_dict(m) for m in data.get("data", [])]

    async def universal_candidates(self, project: str) -> list[Memory]:
        """Detect universal candidates asynchronously."""
        data = await self._get(f"/api/projects/{project}/candidates")
        return [Memory.from_dict(m) for m in data.get("data", [])]

    # ------------------------------------------------------------------
    # Analytics
    # ------------------------------------------------------------------

    async def analytics(self, *, project: str | None = None) -> MemoryAnalytics:
        """Get analytics overview asynchronously."""
        data = await self._get("/api/analytics/overview", params={"project": project or self.project})
        return MemoryAnalytics.from_dict(data["data"])

    async def analytics_survival(self, *, project: str | None = None) -> list[dict[str, Any]]:
        """Get survival curve data asynchronously."""
        data = await self._get("/api/analytics/survival", params={"project": project or self.project})
        return data.get("data", [])

    async def analytics_movements(
        self, *, days: int = 30, project: str | None = None
    ) -> list[dict[str, Any]]:
        """Get orbit movement data asynchronously."""
        data = await self._get(
            "/api/analytics/movements",
            params={"project": project or self.project, "days": days},
        )
        return data.get("data", [])

    async def analytics_clusters(self, *, project: str | None = None) -> list[dict[str, Any]]:
        """Get topic clusters asynchronously."""
        data = await self._get("/api/analytics/clusters", params={"project": project or self.project})
        return data.get("data", [])

    async def analytics_patterns(self, *, project: str | None = None) -> list[dict[str, Any]]:
        """Detect access patterns asynchronously."""
        data = await self._get("/api/analytics/patterns", params={"project": project or self.project})
        return data.get("data", [])

    async def analytics_health(self, *, project: str | None = None) -> dict[str, Any]:
        """Get health metrics asynchronously."""
        data = await self._get("/api/analytics/health", params={"project": project or self.project})
        return data.get("data", {})

    async def analytics_report(self, *, project: str | None = None) -> str:
        """Generate analytics report asynchronously."""
        data = await self._get("/api/analytics/report", params={"project": project or self.project})
        return data.get("data", "")

    # ------------------------------------------------------------------
    # Temporal
    # ------------------------------------------------------------------

    async def temporal_at(self, timestamp: str, *, project: str | None = None) -> list[Memory]:
        """Get memories valid at a specific timestamp asynchronously."""
        params = {"timestamp": timestamp, "project": project or self.project}
        data = await self._get("/api/temporal/at", params=params)
        return [Memory.from_dict(m) for m in data.get("data", [])]

    async def temporal_chain(self, memory_id: str) -> list[Memory]:
        """Get evolution chain asynchronously."""
        data = await self._get(f"/api/temporal/chain/{memory_id}")
        return [Memory.from_dict(m) for m in data.get("data", [])]

    async def temporal_summary(self, *, project: str | None = None) -> str:
        """Get temporal summary asynchronously."""
        data = await self._get("/api/temporal/summary", params={"project": project or self.project})
        return data.get("data", "")

    async def set_temporal_bounds(
        self,
        memory_id: str,
        *,
        valid_from: str | None = None,
        valid_until: str | None = None,
    ) -> bool:
        """Set temporal bounds asynchronously."""
        body: dict[str, Any] = {}
        if valid_from is not None:
            body["valid_from"] = valid_from
        if valid_until is not None:
            body["valid_until"] = valid_until
        await self._post(f"/api/temporal/bounds/{memory_id}", json=body)
        return True

    async def supersede_memory(self, old_id: str, new_id: str) -> bool:
        """Supersede a memory asynchronously."""
        await self._post("/api/temporal/supersede", json={"oldId": old_id, "newId": new_id})
        return True

    # ------------------------------------------------------------------
    # Conflicts
    # ------------------------------------------------------------------

    async def conflicts(self, *, project: str | None = None) -> list[MemoryConflict]:
        """List unresolved conflicts asynchronously."""
        data = await self._get("/api/conflicts", params={"project": project or self.project})
        return [MemoryConflict.from_dict(c) for c in data.get("data", [])]

    async def conflicts_for_memory(self, memory_id: str) -> list[MemoryConflict]:
        """Get conflicts for a specific memory asynchronously."""
        data = await self._get(f"/api/conflicts/{memory_id}")
        return [MemoryConflict.from_dict(c) for c in data.get("data", [])]

    async def resolve_conflict(
        self,
        conflict_id: str,
        *,
        resolution: str = "Resolved",
        action: Literal["supersede", "dismiss", "keep_both"] = "supersede",
    ) -> bool:
        """Resolve a conflict asynchronously."""
        await self._post(
            f"/api/conflicts/{conflict_id}/resolve",
            json={"resolution": resolution, "action": action},
        )
        return True

    async def dismiss_conflict(self, conflict_id: str, *, resolution: str = "Dismissed") -> bool:
        """Dismiss a conflict asynchronously."""
        await self._post(
            f"/api/conflicts/{conflict_id}/dismiss",
            json={"resolution": resolution},
        )
        return True

    # ------------------------------------------------------------------
    # Observations
    # ------------------------------------------------------------------

    async def observe(self, conversation: str, *, project: str | None = None) -> ObservationResult:
        """Process a conversation for implicit memories asynchronously."""
        proj = project or self.project
        data = await self._post(
            "/api/observations/process",
            json={"conversation": conversation, "project": proj},
        )
        return ObservationResult.from_dict(data.get("data", {}), project=proj)

    async def list_observations(
        self, *, limit: int = 20, project: str | None = None
    ) -> list[dict[str, Any]]:
        """List observations asynchronously."""
        params = {"project": project or self.project, "limit": limit}
        data = await self._get("/api/observations", params=params)
        return data.get("data", [])

    # ------------------------------------------------------------------
    # Consolidation
    # ------------------------------------------------------------------

    async def consolidation_candidates(
        self, *, project: str | None = None
    ) -> list[ConsolidationCandidate]:
        """Find consolidation candidates asynchronously."""
        data = await self._get(
            "/api/consolidation/candidates",
            params={"project": project or self.project},
        )
        return [ConsolidationCandidate.from_dict(c) for c in data.get("data", [])]

    async def consolidate(self, *, project: str | None = None) -> dict[str, Any]:
        """Run consolidation asynchronously."""
        data = await self._post("/api/consolidation/run", json={"project": project or self.project})
        return data.get("data", {})

    async def consolidation_history(self, consolidated_id: str) -> list[Memory]:
        """Get consolidation source memories asynchronously."""
        data = await self._get(f"/api/consolidation/history/{consolidated_id}")
        return [Memory.from_dict(m) for m in data.get("data", [])]

    # ------------------------------------------------------------------
    # Scan
    # ------------------------------------------------------------------

    async def scan(
        self,
        path: str,
        *,
        recursive: bool = True,
        git: bool = True,
        max_kb: int | None = None,
    ) -> ScanResult:
        """Trigger a directory scan asynchronously."""
        body: dict[str, Any] = {"path": path, "recursive": recursive, "git": git}
        if max_kb is not None:
            body["max_kb"] = max_kb

        data = await self._post("/api/scan", json=body)
        return ScanResult.from_dict(data.get("data", {}))

    async def scan_status(self) -> dict[str, Any]:
        """Check scan status asynchronously."""
        data = await self._get("/api/scan/status")
        return data.get("data", {})

    async def cancel_scan(self) -> bool:
        """Cancel an in-progress scan asynchronously."""
        await self._post("/api/scan/cancel")
        return True

    async def list_sources(self) -> list[DataSource]:
        """List data sources asynchronously."""
        data = await self._get("/api/sources")
        return [DataSource.from_dict(s) for s in data.get("data", [])]


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------


def _clean_params(params: dict[str, Any] | None) -> dict[str, Any]:
    """Remove None values from query param dicts (httpx passes them as 'None' strings)."""
    if not params:
        return {}
    return {k: v for k, v in params.items() if v is not None}
