// Shared helper for the Agent Pet bridge scripts (codex-hook.js, pet-notify.js).
// One job: POST a {agent,status,message,emoji} event to the pet at 127.0.0.1:7331,
// fire-and-forget, and (optionally) locate/launch the pet app. Stdlib-only so the
// hooks have zero install step. The Claude Code hook predates this and keeps its
// own copy on purpose — we don't want to risk that working integration.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PET_URL = process.env.AGENT_PET_URL || 'http://127.0.0.1:7331';

// Resolves true if the pet received the event, false if it's unreachable.
// Never rejects — a down pet must never break the agent that called us.
function post(payload, url = PET_URL) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(payload));
    let u;
    try {
      u = new URL(url + '/event');
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

module.exports = { post, findPetExe, launchPet, delay, PET_URL };
