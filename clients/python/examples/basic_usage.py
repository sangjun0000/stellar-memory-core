"""Basic Stellar Memory SDK usage examples.

Run the Stellar Memory API first:
    cd /path/to/stellar-memory
    npm run api

Then run this script:
    python examples/basic_usage.py
"""

from stellar_memory import StellarMemory, NotFoundError


def main() -> None:
    # Create a client — defaults to http://localhost:21547, project "default"
    client = StellarMemory()

    # Check the server is running
    info = client.health()
    print(f"Connected to {info['name']} v{info['version']}")

    # ----------------------------------------------------------------
    # Store memories
    # ----------------------------------------------------------------

    decision = client.remember(
        "Chose PostgreSQL over MySQL because of better JSON support and LISTEN/NOTIFY",
        type="decision",
        tags=["database", "postgresql", "architecture"],
        impact=0.8,
    )
    print(f"\nStored decision: {decision.id}")
    print(f"  Summary : {decision.summary}")
    print(f"  Distance: {decision.distance:.2f} AU")

    error_mem = client.remember(
        "Auth middleware 401 was caused by expired JWT secret — regenerate and rotate secrets",
        type="error",
        tags=["auth", "jwt", "security"],
    )
    print(f"\nStored error: {error_mem.id}")

    task_mem = client.remember(
        "Add rate limiting to all /api endpoints before launch",
        type="task",
        tags=["api", "security", "launch"],
    )
    print(f"\nStored task: {task_mem.id}")

    # ----------------------------------------------------------------
    # Recall memories
    # ----------------------------------------------------------------

    results = client.recall("database choice", limit=5)
    print(f"\nRecall 'database choice' → {len(results)} result(s):")
    for m in results:
        print(f"  [{m.type:12s}] {m.summary[:60]}  ({m.distance:.1f} AU)")

    # ----------------------------------------------------------------
    # Fetch a specific memory
    # ----------------------------------------------------------------

    fetched = client.get_memory(decision.id)
    print(f"\nFetched by ID: {fetched.summary}")

    # ----------------------------------------------------------------
    # List memories by zone
    # ----------------------------------------------------------------

    core_memories = client.list_memories(zone="core", limit=10)
    print(f"\nCore zone memories: {len(core_memories)}")

    # ----------------------------------------------------------------
    # System status
    # ----------------------------------------------------------------

    status = client.status()
    print(f"\nSystem status — {status.memory_count} memories:")
    for zone, count in status.zone_breakdown.items():
        if count:
            print(f"  {zone:10s}: {count}")

    # ----------------------------------------------------------------
    # Commit session state to the Sun
    # ----------------------------------------------------------------

    sun = client.commit(
        current_work="Setting up database layer with PostgreSQL",
        decisions=["PostgreSQL chosen over MySQL for JSON and LISTEN/NOTIFY"],
        next_steps=["Add rate limiting", "Set up connection pooling", "Write migrations"],
        errors=["JWT secret was expired — rotated successfully"],
        context="Node.js backend, Drizzle ORM, Docker deployment",
    )
    print(f"\nCommitted to Sun at {sun.last_commit_at}")
    print(f"  Current work  : {sun.current_work}")
    print(f"  Next steps    : {sun.next_steps}")

    # ----------------------------------------------------------------
    # Forget a memory
    # ----------------------------------------------------------------

    client.forget(task_mem.id, mode="push")  # push to Oort cloud
    print(f"\nForgot task memory {task_mem.id} (pushed to outer orbit)")

    # ----------------------------------------------------------------
    # Handle errors gracefully
    # ----------------------------------------------------------------

    try:
        client.get_memory("nonexistent-id-12345")
    except NotFoundError as exc:
        print(f"\nExpected error: {exc}")

    client.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
