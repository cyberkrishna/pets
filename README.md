# Agent Pet 🐾

A floating desktop pet that reacts to your active agent sessions and gives you updates —
in the style of [OpenPets](https://github.com/alvinunreal/openpets): a small always-on-top
sprite companion with a speech bubble and a status badge, which idles, occasionally strolls
along your screen, and animates to what your agents are doing. The default pet is OpenPets'
own MIT-licensed pixel pup (see `pets/openpets-default/CREDITS.txt`).

It reacts in real time to two kinds of signals:

1. **HTTP webhook** — any agent (LangChain, CrewAI, your own scripts) `POST`s a tiny JSON
   event to `http://127.0.0.1:7331/event` and the pet changes mood, speaks, and shows a toast.
2. **Log-file tailing** — point it at log files you already write; matching lines trigger reactions.

Built with Electron. The original browser prototype is kept as `desktop-pet.html`, while
the desktop app now uses `renderer/pet.html` plus switchable pet packs from `pets/`.

## Install it (packaged app)

Build the Windows installer + portable exe:

```powershell
cd D:\pets
npm install
npm run dist        # → dist/Agent Pet-Setup-<version>.exe and dist/Agent Pet-Portable-<version>.exe
```

- **Setup exe**: one-click per-user install (no admin), Start-menu shortcut, uninstaller.
- **Portable exe**: single file, run from anywhere — nothing to install.

The packaged app stores your editable files per-user under `%APPDATA%\Agent Pet\`
(dev runs via `npm start` use `%APPDATA%\agent-pet\` instead):

- `pet.config.json` — port + log-tail rules (seeded from the default on first launch).
  Tray → **Edit config** opens it; restart the pet to apply.
- `pets\` — drop extra pet packs here (tray → **Add pets…** opens the folder, **Reload pets**
  picks them up without a restart). Packs here shadow built-in packs with the same id.

The tray menu also has **Start with Windows** to auto-launch the pet at login. The Python
SDK and the agent hooks (Claude Code, Codex, generic sender) ship alongside the installed
app in `resources\integrations\`.

## Run it from source (dev)

```powershell
cd D:\pets
npm install
npm start
```

The pet appears in the bottom-right corner in a compact 220×320 window (OpenPets-sized):
just the sprite, a speech bubble, and a small reaction badge. The rest of the window is
click-through, so it never blocks your desktop. Drag the pet to move it; the position is
remembered between runs (and clamped back on-screen if displays change). When nothing has
happened for a while, the pet takes short ambient strolls left or right, playing its walk
animation.

### Play with it 🎾

- **Pet it** — stroke back and forth over it a few times → hearts + a purr.
- **Double-click** (or right-click → **Play**) — it jumps with hearts.
- **Fling it** — drag fast and let go: the pet sails with gravity, bounces off the
  floor and screen edges, and settles. Grab it mid-flight to catch it.
- **Click it** — a little chat line and a wiggle.

### When a session needs your input 🔔

If an agent reports `waiting` (e.g. a Claude Code permission prompt), the pet goes into
**attention mode**: it calls out in its bubble, waves, plays a soft chime, and hops the
window every few seconds until you respond or click the pet to acknowledge. Sound can be
turned off with right-click → **Mute** (persisted).

The tray icon (purple dot) gives you **Show/Hide**, a **Pet** submenu for switching pet
packs, and **Quit**. You can also right-click the pet and choose **Next pet**.

## Send it an event (webhook)

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:7331/event -Method Post `
  -ContentType 'application/json' `
  -Body '{"agent":"langchain-agent","status":"running","message":"Calling web_search…"}'
```

### Event schema

| field     | required | values / notes                                         |
|-----------|----------|--------------------------------------------------------|
| `agent`   | no       | any string id; a status card is created on the fly     |
| `status`  | no       | see supported statuses below; default `idle`            |
| `message` | no       | shown in the speech bubble + toast                     |
| `emoji`   | no       | overrides the toast icon                               |

Supported statuses:

- Legacy: `running`, `done`, `error`, `idle`.
- Rich reactions: `thinking`, `working`, `editing`, `testing`, `waiting`, `waving`,
  `success`, `celebrating`.

The renderer maps all statuses onto pet animations. Sprite packs use the common animation
states documented in [pets/README.md](pets/README.md).

Health check: `Invoke-RestMethod http://127.0.0.1:7331/health` → `{ ok: true }`.

### Python one-liner (any agent framework)

```python
import requests
def notify(agent, status, message="", emoji=""):
    try:
        requests.post("http://127.0.0.1:7331/event",
                      json={"agent": agent, "status": status, "message": message, "emoji": emoji},
                      timeout=0.5)
    except requests.RequestException:
        pass  # pet not running — never break the agent

notify("my-agent", "running", "Starting research…")
notify("my-agent", "done", "Finished!")
```

## Watch a log file

Edit `pet.config.json`. Replace the example entry (`"_example": true` makes it inert) with a
real one:

```json
{
  "port": 7331,
  "logs": [
    {
      "file": "C:/Users/you/agent.log",
      "agent": "my-agent",
      "rules": [
        { "match": "error|exception|traceback", "status": "error" },
        { "match": "done|completed|success",     "status": "done" },
        { "match": "running|calling|invoking",   "status": "running" }
      ]
    }
  ]
}
```

- Use **forward slashes** in `file` paths (they work on Windows and avoid JSON-escaping issues).
- `match` is a case-insensitive regex; the **first** matching rule per line wins.
- Only newly appended lines trigger reactions (history on startup is ignored).
- Missing files are skipped and retried; rotated/truncated files are handled.

Restart the app after editing the config.

## Files

| file                 | role                                                            |
|----------------------|-----------------------------------------------------------------|
| `main.js`            | Electron main: window, HTTP server, log tailer, IPC, tray       |
| `preload.js`         | secure `contextBridge` → `window.petAPI`                        |
| `renderer/pet.html`  | the pet UI (SVG/sprite rendering, animations, event handling)   |
| `pet.config.json`    | port + log-tail rules                                            |
| `pets/`              | switchable pet packs, including SVG and sprite-sheet pets        |
| `sdk/`               | Python SDK (`agent_pet`) + LangChain/CrewAI callbacks — see [sdk/README.md](sdk/README.md) |
| `hooks/`             | Agent integrations (Claude Code, Codex, generic sender) — see [hooks/README.md](hooks/README.md) |
| `tools/`             | dev utilities: placeholder/sprite generators, `make-icon.js` (app icon) |
| `desktop-pet.html`   | original browser prototype (reference only)                     |

## Integrations

- **Any Python agent** → [`sdk/`](sdk/README.md): `notify()`, a `track()` context manager,
  and drop-in **LangChain** (`PetCallbackHandler`) + **CrewAI** callbacks. Stdlib-only core.
- **Claude Code** (this very tool) → [`hooks/`](hooks/README.md): the pet reacts when your
  Claude Code sessions start, work, finish, or need your input.
- **OpenAI Codex** (CLI + VS Code extension) → [`hooks/`](hooks/README.md#openai-codex--agent-pet-hooks):
  the pet waves, works, calls for you when Codex needs approval, and celebrates along with your Codex sessions.
- **Any other agent/tool** → [`hooks/pet-notify.js`](hooks/README.md#connect-any-agent): a
  one-line sender (no Python) so Cursor, Gemini CLI, CI steps, or your own scripts can drive the pet.
- **Custom pets** → [`pets/`](pets/README.md): add a `pets/<id>/pet.json` pack, optionally
  with a sprite sheet, then restart and switch from the tray.

## Security

The HTTP server binds to `127.0.0.1` only — never exposed to your network. The renderer runs
with `contextIsolation` on and `nodeIntegration` off; it can only reach the explicit methods
exposed on `window.petAPI`.

## Not yet included (ideas for later)

- AI-generated custom pet from a photo (the prototype's upload flow; needs an API key wired).
- Multi-monitor edge-snapping; richer per-agent history panel.
- Code signing for the installer (unsigned builds show a SmartScreen warning on first run —
  click **More info → Run anyway**).
