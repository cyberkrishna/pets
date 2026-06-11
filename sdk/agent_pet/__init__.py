"""agent_pet — tiny client for the Agent Pet desktop companion.

Send events to a locally-running pet so it reacts to your agent sessions.
The core `notify()` uses only the Python standard library and is fire-and-forget:
it posts in a background thread and swallows all errors, so it can never block
or break your agent — if the pet isn't running, calls are silently no-ops.

Quick start
-----------
    from agent_pet import notify, track

    notify("my-agent", "running", "Starting research…")
    notify("my-agent", "done", "Finished!")

    # Or wrap a block: running on enter, done on success, error on exception.
    with track("my-agent", "Summarizing docs"):
        do_work()

Framework callbacks live in `agent_pet.langchain` and `agent_pet.crewai`.
"""
from __future__ import annotations

import json
import os
import threading
import urllib.request
from contextlib import contextmanager

__all__ = ["notify", "track", "PetClient"]

DEFAULT_URL = os.environ.get("AGENT_PET_URL", "http://127.0.0.1:7331")

VALID_STATUS = {"running", "done", "error", "idle"}


def _post(url: str, payload: dict, timeout: float) -> None:
    """Blocking POST. Errors are swallowed by the caller's thread wrapper."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url + "/event",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=timeout).close()
    except Exception:
        # Pet not running / network hiccup — never propagate to the agent.
        pass


def notify(
    agent: str,
    status: str = "idle",
    message: str = "",
    emoji: str = "",
    *,
    url: str = DEFAULT_URL,
    timeout: float = 0.5,
    blocking: bool = False,
) -> None:
    """Send one event to the pet.

    agent:   id shown on a status card (any string).
    status:  running | done | error | idle.
    message: shown in the pet's speech bubble + toast.
    emoji:   optional toast icon override.
    blocking: wait for the POST (default False = fire-and-forget thread).
    """
    if status not in VALID_STATUS:
        status = "idle"
    payload = {"agent": agent, "status": status, "message": message, "emoji": emoji}

    if blocking:
        _post(url, payload, timeout)
    else:
        t = threading.Thread(target=_post, args=(url, payload, timeout), daemon=True)
        t.start()


@contextmanager
def track(agent: str, message: str = "", *, url: str = DEFAULT_URL):
    """Context manager: emit `running` on enter, `done` on success,
    `error` on exception (the exception still propagates)."""
    notify(agent, "running", message or "Working…", url=url)
    try:
        yield
    except Exception as exc:  # noqa: BLE001 — we re-raise below
        notify(agent, "error", f"{type(exc).__name__}: {exc}"[:140], url=url)
        raise
    else:
        notify(agent, "done", message or "Done!", url=url)


class PetClient:
    """Convenience wrapper that pins an agent id (and optional URL)."""

    def __init__(self, agent: str, *, url: str = DEFAULT_URL):
        self.agent = agent
        self.url = url

    def notify(self, status: str, message: str = "", emoji: str = "") -> None:
        notify(self.agent, status, message, emoji, url=self.url)

    def track(self, message: str = ""):
        return track(self.agent, message, url=self.url)
