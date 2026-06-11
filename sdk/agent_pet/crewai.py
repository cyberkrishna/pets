"""CrewAI integration for the Agent Pet.

CrewAI exposes `step_callback` (per agent step) and `task_callback` (per task)
hooks rather than a callback class. These helpers return callables you drop
straight into a Crew / Agent / Task.

Usage
-----
    from agent_pet.crewai import pet_step_callback, pet_task_callback

    crew = Crew(
        agents=[...],
        tasks=[...],
        step_callback=pet_step_callback("crewai-bot"),
        task_callback=pet_task_callback("crewai-bot"),
    )

No CrewAI import is required here — the callbacks just read attributes
defensively from whatever object CrewAI passes in.
"""
from __future__ import annotations

from typing import Any, Callable

from . import notify


def pet_step_callback(agent: str = "crewai-bot", *, url: str | None = None) -> Callable[[Any], None]:
    """Return a `step_callback` that pings the pet on every agent step."""
    url_kw = {"url": url} if url else {}

    def _cb(step: Any) -> None:
        # CrewAI step objects vary by version; pull a short label defensively.
        label = (
            getattr(step, "tool", None)
            or getattr(step, "action", None)
            or getattr(step, "thought", None)
            or "working…"
        )
        notify(agent, "running", f"Step: {str(label)[:100]}", **url_kw)

    return _cb


def pet_task_callback(agent: str = "crewai-bot", *, url: str | None = None) -> Callable[[Any], None]:
    """Return a `task_callback` that pings the pet when a task completes."""
    url_kw = {"url": url} if url else {}

    def _cb(output: Any) -> None:
        desc = getattr(output, "description", None) or getattr(output, "name", None) or "Task"
        notify(agent, "done", f"{str(desc)[:100]} ✓", **url_kw)

    return _cb
