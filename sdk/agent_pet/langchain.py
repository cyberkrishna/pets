"""LangChain callback handler for the Agent Pet.

Usage
-----
    from agent_pet.langchain import PetCallbackHandler

    llm = ChatOpenAI(callbacks=[PetCallbackHandler("langchain-agent")])
    # or pass at call time:
    chain.invoke(input, config={"callbacks": [PetCallbackHandler("my-chain")]})

The handler maps LangChain lifecycle events onto pet moods:
  chain/LLM/tool start -> running (focused)
  tool end             -> running (a quick "tool done" beat)
  chain/LLM end        -> done    (happy)
  any error            -> error   (wobble)

Importing this module does not require LangChain at import time; the base class
is resolved lazily so `agent_pet` stays dependency-free until you actually use it.
"""
from __future__ import annotations

from typing import Any

from . import notify

try:  # LangChain is an optional dependency.
    from langchain_core.callbacks.base import BaseCallbackHandler
except Exception:  # pragma: no cover - exercised only without langchain installed
    try:
        from langchain.callbacks.base import BaseCallbackHandler  # older layout
    except Exception:
        BaseCallbackHandler = object  # type: ignore[assignment, misc]


class PetCallbackHandler(BaseCallbackHandler):  # type: ignore[misc]
    """Wire LangChain runs to the desktop pet. Construct with an agent label."""

    def __init__(self, agent: str = "langchain-agent", *, url: str | None = None):
        super().__init__() if BaseCallbackHandler is not object else None
        self.agent = agent
        self._url_kw = {"url": url} if url else {}

    # ── chains ──────────────────────────────────────────────────────────────
    def on_chain_start(self, serialized: dict, inputs: dict, **kwargs: Any) -> None:
        name = (serialized or {}).get("name", "chain")
        notify(self.agent, "running", f"Chain start: {name}", **self._url_kw)

    def on_chain_end(self, outputs: dict, **kwargs: Any) -> None:
        notify(self.agent, "done", "Chain complete ✓", **self._url_kw)

    def on_chain_error(self, error: BaseException, **kwargs: Any) -> None:
        notify(self.agent, "error", f"Chain error: {error}"[:140], **self._url_kw)

    # ── LLM ─────────────────────────────────────────────────────────────────
    def on_llm_start(self, serialized: dict, prompts: list, **kwargs: Any) -> None:
        notify(self.agent, "running", "Thinking… 🧠", **self._url_kw)

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        notify(self.agent, "done", "Got a response ✓", **self._url_kw)

    def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        notify(self.agent, "error", f"LLM error: {error}"[:140], **self._url_kw)

    # ── tools ───────────────────────────────────────────────────────────────
    def on_tool_start(self, serialized: dict, input_str: str, **kwargs: Any) -> None:
        name = (serialized or {}).get("name", "tool")
        notify(self.agent, "running", f"Calling {name} 🔧", emoji="🔧", **self._url_kw)

    def on_tool_end(self, output: str, **kwargs: Any) -> None:
        notify(self.agent, "running", "Tool finished", **self._url_kw)

    def on_tool_error(self, error: BaseException, **kwargs: Any) -> None:
        notify(self.agent, "error", f"Tool error: {error}"[:140], **self._url_kw)
