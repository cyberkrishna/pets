#!/usr/bin/env node
// OpenAI Codex → Agent Pet hook (works with the Codex CLI and the VS Code Codex
// extension — both read ~/.codex/hooks.json). Registered on SessionStart /
// UserPromptSubmit / PreToolUse / Stop (see hooks/codex-hooks.json + README).
// Codex pipes the hook event JSON on stdin; we POST a matching event to the pet.
//
// SAFETY CONTRACT: Codex hooks can BLOCK a turn (deny a tool, reject a prompt,
// force a continuation) via stdout or a non-zero exit. This bridge is a pure
// OBSERVER: it writes NOTHING to stdout and ALWAYS exits 0, so it can never
// interfere with Codex — omitting stdout means "accept" for every event.
const { post, launchPet, delay } = require('./pet-client');

const AGENT = 'codex';

// Map a Codex hook event to a pet event ({agent,status,message,emoji}).
// Returns null for events we don't surface.
function toPetEvent(h) {
  switch (h.hook_event_name) {
    case 'SessionStart':
      return { agent: AGENT, status: 'waving', message: `Session started (${h.source || 'startup'})`, emoji: '👋' };
    case 'UserPromptSubmit': {
      const p = (h.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      return { agent: AGENT, status: 'working', message: p ? `Working on: ${p}` : 'Working…', emoji: '🛠️' };
    }
    case 'PermissionRequest': {
      // Codex is about to PAUSE and ask you to approve something — this event
      // fires ONLY when approval is actually needed. Map it to `waiting` so the
      // pet enters attention mode (waves, chimes, hops) until you respond, just
      // like a Claude Code permission prompt. We only observe; the approval
      // prompt still shows normally (the bridge writes no decision).
      const tool = typeof h.tool_name === 'string' ? h.tool_name : '';
      const why = (h.tool_input && typeof h.tool_input.description === 'string')
        ? h.tool_input.description
        : (tool ? `${tool} needs approval` : 'Needs your approval');
      return { agent: AGENT, status: 'waiting', message: `${why} 👀`, emoji: '🔔' };
    }
    case 'PreToolUse': {
      // Normal liveness while a tool runs (no approval pause):
      // file-mutating tools → editing, everything else → working.
      const tool = typeof h.tool_name === 'string' ? h.tool_name : '';
      const editing = /^(Write|Edit|Apply|Patch|MultiEdit)/i.test(tool);
      return {
        agent: AGENT,
        status: editing ? 'editing' : 'working',
        message: tool ? `Running ${tool}` : 'Working…',
        emoji: editing ? '✏️' : '🛠️',
      };
    }
    case 'Stop':
      return { agent: AGENT, status: 'success', message: 'Finished responding ✓', emoji: '✅' };
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
    // Strip a UTF-8 BOM if present (Windows/PowerShell can prepend one; there's
    // also a known Codex Windows bug that mangles stdin on non-ASCII messages).
    hook = JSON.parse(raw.replace(/^﻿/, '') || '{}');
  } catch {
    process.exit(0); // malformed input — do nothing, never block Codex
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
// Safety: never hang Codex if stdin never closes (or the retry stalls).
setTimeout(() => process.exit(0), 8000);
