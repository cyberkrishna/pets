#!/usr/bin/env node
// Generic "connect ANY agent" sender for the Agent Pet. One command, no Python,
// no SDK — drive the pet from any tool, script, CI step, or shell.
//
//   node pet-notify.js <status> [message] [emoji] [agent]
//
// Examples:
//   node pet-notify.js working "Building the project" 🛠️ ci
//   node pet-notify.js success "Tests passed"
//   node pet-notify.js waiting "Needs your approval" 🔔 deploy-bot
//
// Exits 0 whether or not the pet is running (a down pet is a silent no-op), so
// it's safe to drop into any pipeline. Override the target with AGENT_PET_URL.
const { post } = require('./pet-client');

// Must match VALID_STATUS in main.js. Unknown input falls back to 'idle'.
const VALID_STATUS = new Set([
  'running', 'done', 'error', 'idle',
  'thinking', 'working', 'editing', 'testing', 'waiting', 'waving',
  'success', 'celebrating',
]);

const [statusArg, message = '', emoji = '', agent = 'agent'] = process.argv.slice(2);

if (!statusArg || statusArg === '-h' || statusArg === '--help') {
  process.stdout.write(
    'Usage: node pet-notify.js <status> [message] [emoji] [agent]\n' +
      'Statuses: ' + [...VALID_STATUS].join(', ') + '\n'
  );
  process.exit(0);
}

const status = VALID_STATUS.has(statusArg) ? statusArg : 'idle';

post({ agent, status, message, emoji }).then((delivered) => {
  if (!delivered) {
    // Not an error — the pet just isn't running. Note it on stderr and move on.
    process.stderr.write('[pet-notify] pet not reachable (is it running?) — skipped\n');
  }
  process.exit(0);
});
