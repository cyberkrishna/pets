# Agent → Agent Pet hooks

Bridges that make coding agents drive the pet. Each bridge reads its agent's hook
event and POSTs a tiny JSON event to the pet at `http://127.0.0.1:7331/event`.

- **[Claude Code](#claude-code--agent-pet-hooks)** — full lifecycle (below).
- **[OpenAI Codex](#openai-codex--agent-pet-hooks)** (CLI + VS Code extension).
- **[Connect ANY agent](#connect-any-agent)** — one-line sender for everything else.

---

## Claude Code → Agent Pet hooks

Make your **Claude Code** sessions drive the pet: it waves on session start, goes
into a working state while Claude works, celebrates when Claude finishes, and waits
for you when Claude needs input or permission.

## How it works

`claude-code-hook.js` is registered on four Claude Code hook events. Each time one fires,
Claude Code pipes the event JSON to the script on stdin, and the script POSTs a matching
event to the pet at `http://127.0.0.1:7331`. It's fire-and-forget (`async: true`) and exits
fast, so it never adds latency — and if the pet isn't running, it's a silent no-op.

| Claude Code event   | Pet reaction                                      |
|---------------------|---------------------------------------------------|
| `SessionStart`      | `waving` - "Session started (...)"                |
| `UserPromptSubmit`  | `working` - "Working on: <your prompt>"           |
| `Stop`              | `success` - "Finished responding"                 |
| `Notification`      | `waiting` for permission/input, otherwise `idle`  |

## Install

1. Make sure the pet is running (`cd D:\pets && npm start`).
2. Merge the `hooks` block from [`settings-snippet.json`](./settings-snippet.json) into your
   Claude Code settings:
   - all projects → `~/.claude/settings.json`
   - this project only → `.claude/settings.json`
3. Fix the script path in each command if you cloned the repo elsewhere
   (`node /your/path/pets/hooks/claude-code-hook.js`). Forward slashes are fine on Windows.
4. Restart Claude Code (or run `/hooks` to reload). Submit a prompt — the pet should react.

## Test it without Claude Code

Pipe a fake event in:

```powershell
'{"hook_event_name":"Stop"}' | node D:\pets\hooks\claude-code-hook.js
```

The pet should use the `success` reaction and say "Finished responding".

---

## OpenAI Codex → Agent Pet hooks

Make your **Codex** sessions drive the pet — in both the **Codex CLI** and the
**VS Code Codex extension** (they share `~/.codex/`). `codex-hook.js` is registered
on Codex's hook events; Codex pipes each event's JSON to it on stdin and the script
POSTs a matching event to the pet.

| Codex event         | Pet reaction                                          |
|---------------------|-------------------------------------------------------|
| `SessionStart`      | `waving` — "Session started (...)"                    |
| `UserPromptSubmit`  | `working` — "Working on: <your prompt>"               |
| `PreToolUse`        | `editing` for file edits, else `working` — "Running <tool>" |
| `PermissionRequest` | `waiting` — attention mode (waves, chimes, hops) until you approve/deny |
| `Stop`              | `success` — "Finished responding"                     |

> **Approval prompts:** Codex's `PermissionRequest` event fires *only* when Codex
> pauses to ask for your approval (a shell escalation, network access, an edit
> outside the workspace, etc.). The pet maps it to the same **attention mode** as a
> Claude Code permission prompt — it waves, plays a chime, and hops until you
> respond. Whether it fires at all depends on your Codex `approval_policy`
> (`untrusted` / `on-request` / `never`) and sandbox mode.

**Safety:** the bridge is a pure observer — it writes nothing to stdout and always
exits 0, so it can never block, deny, or force-continue a Codex turn (the real
approval prompt still shows normally).

### Install

1. Make sure the pet is running (`cd D:\pets && npm start`, or launch the app).
2. Copy the contents of [`codex-hooks.json`](./codex-hooks.json) into your
   **user-level** `~/.codex/hooks.json` (merge if the file already exists). Codex
   ignores the hooks key in project-local configs, so it must be the user-level file.
   - Alternatively, use the inline `[[hooks.<Event>]]` form in `~/.codex/config.toml`.
3. Fix the script path if you cloned the repo elsewhere
   (`node /your/path/pets/hooks/codex-hook.js`). Forward slashes are fine on Windows.
4. Restart Codex (or the VS Code extension). Submit a prompt — the pet should react.

### Test it without Codex

```powershell
'{"hook_event_name":"UserPromptSubmit","prompt":"fix the login bug"}' | node D:\pets\hooks\codex-hook.js
```

The pet should switch to `working` and say "Working on: fix the login bug".

---

## Connect ANY agent

The pet is agent-agnostic — anything that can POST to `http://127.0.0.1:7331/event`
drives it. For tools without a dedicated bridge (Cursor, Gemini CLI, a CI step, your
own script), use the one-line sender — no Python, no SDK:

```powershell
node D:\pets\hooks\pet-notify.js <status> [message] [emoji] [agent]

# examples
node D:\pets\hooks\pet-notify.js working "Building" 🛠️ ci
node D:\pets\hooks\pet-notify.js success "Tests passed"
```

It exits 0 even when the pet is down, so it's safe to drop into any pipeline. Set
`AGENT_PET_URL` to target a non-default host/port. Statuses are the same set the
webhook accepts (see the [root README](../README.md#event-schema)); unknown values
fall back to `idle`.

For Python agents, the [`sdk/`](../sdk/README.md) package offers the same thing plus
LangChain/CrewAI callbacks. The raw HTTP contract is documented in the
[root README](../README.md#send-it-an-event-webhook).
