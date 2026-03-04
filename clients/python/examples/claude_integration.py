"""How to integrate Stellar Memory with AI agents (Claude, GPT, etc.).

This example shows two common patterns:
  1. Wrapping an AI agent to automatically persist memories after each turn.
  2. Injecting recalled memories into the system prompt as context.

Run the Stellar Memory API first:
    cd /path/to/stellar-memory
    npm run api

Then install the Anthropic SDK if you want to run the live Claude example:
    pip install anthropic
"""

from __future__ import annotations

import asyncio
from typing import Any

from stellar_memory import AsyncStellarMemory, StellarMemory


# ---------------------------------------------------------------------------
# Pattern 1 — Sync wrapper that persists conversation observations
# ---------------------------------------------------------------------------


class MemoryAwareAgent:
    """A thin wrapper around any LLM that auto-stores important observations.

    After each assistant turn, the full conversation is fed to Stellar Memory's
    observation API, which extracts and stores key facts automatically.
    """

    def __init__(self, project: str = "agent-session") -> None:
        self.memory = StellarMemory(project=project)
        self.history: list[dict[str, str]] = []

    def _build_system_prompt(self) -> str:
        """Inject recalled memories into the system prompt."""
        # Load the Sun context (committed working state)
        sun = self.memory.get_sun()
        sun_context = ""
        if sun and sun.current_work:
            sun_context = f"\n\nCurrent work context:\n{sun.content}"

        # Recall the top relevant memories based on recent conversation
        recent_text = " ".join(m["content"] for m in self.history[-3:]) if self.history else ""
        memories: list[Any] = []
        if recent_text:
            memories = self.memory.recall(recent_text, limit=5, zone="core")

        memory_context = ""
        if memories:
            lines = [f"- [{m.type}] {m.summary}" for m in memories]
            memory_context = "\n\nRelevant memories:\n" + "\n".join(lines)

        return (
            "You are a helpful AI assistant with persistent memory.\n"
            "Use the context below to give informed, consistent answers."
            + sun_context
            + memory_context
        )

    def chat(self, user_message: str) -> str:
        """Send a message and auto-store observations from the exchange.

        In a real integration replace the simulated response below with an
        actual LLM API call using the system prompt from _build_system_prompt().
        """
        system_prompt = self._build_system_prompt()
        self.history.append({"role": "user", "content": user_message})

        # --- Replace this block with a real LLM call ---
        # Example with Anthropic:
        #
        # import anthropic
        # client = anthropic.Anthropic()
        # response = client.messages.create(
        #     model="claude-opus-4-6",
        #     max_tokens=1024,
        #     system=system_prompt,
        #     messages=self.history,
        # )
        # assistant_message = response.content[0].text
        assistant_message = f"[Simulated response to: {user_message}]"
        # -----------------------------------------------

        self.history.append({"role": "assistant", "content": assistant_message})

        # Auto-observe the conversation to extract implicit memories
        conversation_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in self.history[-6:]
        )
        try:
            result = self.memory.observe(conversation_text)
            if result.memories_created > 0:
                print(f"  [memory] +{result.memories_created} new memories extracted")
        except Exception:
            pass  # observation errors are non-fatal

        return assistant_message

    def end_session(self, summary: str, next_steps: list[str] | None = None) -> None:
        """Commit the session to the Sun anchor before closing."""
        self.memory.commit(
            current_work=summary,
            next_steps=next_steps or [],
        )
        self.memory.close()
        print("Session committed to Sun.")


# ---------------------------------------------------------------------------
# Pattern 2 — Async: inject memories into a LangChain-style prompt template
# ---------------------------------------------------------------------------


async def build_context_prompt(query: str, project: str = "default") -> str:
    """Retrieve relevant memories and format them for injection into a prompt.

    Args:
        query: The user's query or current topic.
        project: Stellar Memory project to query.

    Returns:
        A formatted string ready to include in a system prompt.
    """
    async with AsyncStellarMemory(project=project) as stm:
        # Load the Sun context
        sun = await stm.get_sun()

        # Recall relevant memories
        memories = await stm.recall(query, limit=8, zone="active")

        # Build the injected context block
        lines: list[str] = ["=== Persistent Memory Context ==="]

        if sun and sun.current_work:
            lines.append(f"\nCurrent work: {sun.current_work}")
            if sun.next_steps:
                lines.append("Next steps:")
                for step in sun.next_steps:
                    lines.append(f"  - {step}")

        if memories:
            lines.append("\nRelevant memories:")
            for m in memories:
                lines.append(f"  [{m.type:12s}] {m.summary}")

        lines.append("=================================")
        return "\n".join(lines)


async def async_example() -> None:
    """Demonstrate async memory recall and storage."""
    async with AsyncStellarMemory(project="async-demo") as stm:
        # Store several memories
        await stm.remember(
            "Using FastAPI + Pydantic v2 for the REST layer",
            type="context",
            tags=["fastapi", "pydantic", "api"],
        )
        await stm.remember(
            "Deployment target is AWS ECS with Fargate — no persistent volumes",
            type="decision",
            tags=["aws", "ecs", "deployment"],
            impact=0.8,
        )
        await stm.remember(
            "CI pipeline: GitHub Actions → Docker → ECR → ECS rolling deploy",
            type="milestone",
            tags=["ci", "github-actions", "deployment"],
        )

        # Recall and display
        results = await stm.recall("deployment infrastructure", limit=5)
        print("Recalled memories about deployment:")
        for m in results:
            print(f"  {m.distance:5.2f} AU  [{m.type}] {m.summary[:70]}")

        # Build a context prompt
        context = await build_context_prompt("AWS deployment pipeline", project="async-demo")
        print("\nGenerated context prompt:\n")
        print(context)

        # Commit session
        await stm.commit(
            current_work="Setting up ECS Fargate deployment pipeline",
            decisions=["FastAPI chosen for REST", "ECS Fargate for stateless containers"],
            next_steps=["Configure ECR lifecycle policy", "Add health check endpoint"],
        )
        print("\nSession committed.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def sync_example() -> None:
    """Demonstrate the MemoryAwareAgent wrapper."""
    print("=== Sync Agent Demo ===\n")
    agent = MemoryAwareAgent(project="sync-demo")

    response = agent.chat("What database should I use for a high-traffic web app?")
    print(f"Assistant: {response}\n")

    response = agent.chat("What about connection pooling?")
    print(f"Assistant: {response}\n")

    agent.end_session(
        summary="Discussing database selection for high-traffic web apps",
        next_steps=["Evaluate PgBouncer vs PgPool-II", "Run load tests"],
    )


def main() -> None:
    sync_example()

    print("\n=== Async Demo ===\n")
    asyncio.run(async_example())


if __name__ == "__main__":
    main()
