# Claude Code → Agent Pet hooks

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
