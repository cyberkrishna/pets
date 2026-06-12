#!/usr/bin/env node
// Claude Code → Agent Pet hook.
// Registered for SessionStart / UserPromptSubmit / Stop / Notification (see hooks/README.md).
// Reads the hook event JSON on stdin and POSTs a matching event to the pet.
// Fire-and-forget: always exits 0 quickly and never blocks Claude Code.
// On SessionStart, if the pet isn't running it is auto-launched (single-instance
// lock in the app makes duplicate launches harmless).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PET_URL = process.env.AGENT_PET_URL || 'http://127.0.0.1:7331';

// Resolves true if the pet received the event, false if it's unreachable.
function post(payload) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload));
    let u;
    try {
      u = new URL(PET_URL + '/event');
    } catch {
      return resolve(false);
    }
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(true));
      }
    );
    req.setTimeout(600, () => req.destroy());
    req.on('error', () => resolve(false)); // pet not running
    req.write(body);
    req.end();
  });
}

// Find the pet app: explicit override → installed app → repo build.
function findPetExe() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    process.env.AGENT_PET_EXE,
    path.join(local, 'Programs', 'Agent Pet', 'Agent Pet.exe'),
    path.join(local, 'Programs', 'agent-pet', 'Agent Pet.exe'),
    path.join(__dirname, '..', 'dist', 'win-unpacked', 'Agent Pet.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function launchPet() {
  const exe = findPetExe();
  if (!exe) return false;
  try {
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Map a hook event to a pet event.
function toPetEvent(h) {
  const agent = 'claude-code';
  switch (h.hook_event_name) {
    case 'SessionStart':
      return { agent, status: 'waving', message: `Session started (${h.source || 'startup'})`, emoji: '👋' };
    case 'UserPromptSubmit': {
      const p = (h.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      return { agent, status: 'working', message: p ? `Working on: ${p}` : 'Working…', emoji: '🛠️' };
    }
    case 'PostToolUse': {
      // Fires after a tool finishes — including right after you approve a
      // permission prompt. Without this the pet stays stuck on "waiting".
      const tool = (h.tool_name || '').trim();
      return { agent, status: 'working', message: tool ? `Working… (${tool})` : 'Working…', emoji: '🛠️' };
    }
    case 'Stop':
      return { agent, status: 'success', message: 'Finished responding ✓', emoji: '✅' };
    case 'Notification': {
      const t = h.notification_type || '';
      // Permission/elicitation prompts are a "waiting on you" state, not a failure.
      if (t === 'permission_prompt' || t === 'elicitation_dialog') {
        return { agent, status: 'waiting', message: 'Needs your input! 👀', emoji: '🔔' };
      }
      if (t === 'idle_prompt') {
        return { agent, status: 'idle', message: 'Waiting for you…', emoji: '💤' };
      }
      return { agent, status: 'idle', message: `Notification: ${t || 'update'}`, emoji: '🔔' };
    }
    default:
      return null;
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', async () => {
  let hook = {};
  try {
    // Strip a UTF-8 BOM if present (PowerShell adds one when piping manually).
    hook = JSON.parse(raw.replace(/^\uFEFF/, '') || '{}');
  } catch {
    process.exit(0); // malformed input — do nothing, don't break Claude Code
  }
  const ev = toPetEvent(hook);
  if (ev) {
    const delivered = await post(ev);
    // A session just started and the pet isn't up — wake it, then greet it.
    // Only SessionStart auto-launches: if the user quit the pet mid-session,
    // other events shouldn't keep resurrecting it.
    if (!delivered && hook.hook_event_name === 'SessionStart' && launchPet()) {
      await delay(3000); // give Electron a moment to boot and bind the port
      await post(ev);
    }
  }
  process.exit(0);
});
// Safety: never hang the host if stdin never closes (or the retry stalls).
setTimeout(() => process.exit(0), 8000);
