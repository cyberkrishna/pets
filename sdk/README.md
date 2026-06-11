# agent-pet (Python SDK)

Send events to the [Agent Pet](../README.md) desktop companion from any Python agent.
The core uses **only the standard library** and is **fire-and-forget** — if the pet
isn't running, calls are silent no-ops and never block or break your agent.

## Install

```bash
pip install -e D:/pets/sdk            # core only
pip install -e "D:/pets/sdk[langchain]"   # + LangChain callback deps
pip install -e "D:/pets/sdk[crewai]"      # + CrewAI deps
```

(Or just copy the `agent_pet/` folder next to your script — no build needed for the core.)

## Core API

```python
from agent_pet import notify, track, PetClient

notify("my-agent", "running", "Starting research…")
notify("my-agent", "done", "Finished!", emoji="🎉")

# Context manager: running on enter, done on success, error on exception.
with track("my-agent", "Summarizing docs"):
    do_work()

# Pinned client:
pet = PetClient("my-agent")
pet.notify("error", "Something broke")
```

`status` is one of `running | done | error | idle`.
Override the endpoint with the `AGENT_PET_URL` env var or `url=` kwarg.

## LangChain

```python
from agent_pet.langchain import PetCallbackHandler

llm = ChatOpenAI(callbacks=[PetCallbackHandler("langchain-agent")])
# or per call:
chain.invoke(x, config={"callbacks": [PetCallbackHandler("my-chain")]})
```

Maps chain/LLM/tool start → focused, end → happy, errors → wobble.

## CrewAI

```python
from agent_pet.crewai import pet_step_callback, pet_task_callback

crew = Crew(
    agents=[...], tasks=[...],
    step_callback=pet_step_callback("crewai-bot"),
    task_callback=pet_task_callback("crewai-bot"),
)
```
