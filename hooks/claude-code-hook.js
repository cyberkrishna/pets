#!/usr/bin/env node
// Claude Code → Agent Pet hook.
// Registered for SessionStart / UserPromptSubmit / Stop / Notification (see hooks/README.md).
// Reads the hook event JSON on stdin and POSTs a matching event to the pet.
// Fire-and-forget: always exits 0 quickly and never blocks Claude Code.
const http = require('http');

const PET_URL = process.env.AGENT_PET_URL || 'http://127.0.0.1:7331';

function post(payload) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload));
    let u;
    try {
      u = new URL(PET_URL + '/event');
    } catch {
      return resolve();
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
        res.on('end', resolve);
      }
    );
    req.setTimeout(600, () => req.destroy());
    req.on('error', () => resolve()); // pet not running — silent no-op
    req.write(body);
    req.end();
  });
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
  if (ev) await post(ev);
  process.exit(0);
});
// Safety: never hang the host if stdin never closes.
setTimeout(() => process.exit(0), 1500);
