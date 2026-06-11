// make-placeholder.js — generate a sprite sheet PNG for a pet without any art.
// Layout matches the pet.json "row per state" format the renderer expects:
// one row per state, `frames` columns of `frameWidth`x`frameHeight` cells.
//
// Each frame draws a simple blobby creature (a colored body + eyes) with a small
// per-frame animation so idle/running/jumping/failed actually look different.
// The result is a real, valid PNG — drop-in replaceable by nicer CC0 art later.
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./png');

// The canonical state rows we render, in order.
const STATE_ORDER = ['idle', 'review', 'running', 'waiting', 'waving', 'jumping', 'failed'];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// A tiny RGBA canvas with a couple of primitive draw ops.
function makeCanvas(w, h) {
  const buf = Buffer.alloc(w * h * 4); // transparent
  const px = (x, y, [r, g, b], a = 255) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  const disc = (cx, cy, rx, ry, color, a = 255) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) px(x, y, color, a);
      }
    }
  };
  return { buf, px, disc };
}

// Draw one creature frame into a sub-region of the sheet canvas.
function drawCreature(sheet, ox, oy, fw, fh, opts) {
  const { body, belly, state, phase, frames } = opts;
  const t = frames > 1 ? phase / frames : 0;     // 0..1 within the cycle
  const wave = Math.sin(t * Math.PI * 2);

  // Per-state motion.
  let bobY = 0, squash = 0, shakeX = 0, lean = 0;
  if (state === 'idle' || state === 'waiting' || state === 'review') bobY = wave * 1.5;
  if (state === 'running') { bobY = Math.abs(wave) * -2; lean = wave * 2; }
  if (state === 'jumping') { bobY = -Math.abs(wave) * (fh * 0.18); squash = wave * 0.12; }
  if (state === 'failed') { shakeX = wave * 3; }
  if (state === 'waving') { lean = wave * 1.5; }

  const cx = ox + fw / 2 + shakeX + lean;
  const groundY = oy + fh * 0.78 + bobY;
  const rx = fw * 0.30 * (1 + squash);
  const ry = fh * 0.30 * (1 - squash);
  const cy = groundY - ry;

  // Shadow.
  sheet.disc(ox + fw / 2, oy + fh * 0.84, fw * 0.26, fh * 0.05, [0, 0, 0], 70);
  // Body + belly.
  sheet.disc(cx, cy, rx, ry, body);
  sheet.disc(cx, cy + ry * 0.25, rx * 0.55, ry * 0.5, belly);

  // Eyes — closed (a dash) on 'failed', otherwise open dots that look toward motion.
  const eyeY = cy - ry * 0.25;
  const eyeDX = rx * 0.35;
  const lookX = state === 'running' ? lean * 0.4 : 0;
  if (state === 'failed') {
    for (let i = -1; i <= 1; i++) {
      sheet.px(cx - eyeDX + i, eyeY, [40, 30, 60]);
      sheet.px(cx + eyeDX + i, eyeY, [40, 30, 60]);
    }
  } else {
    sheet.disc(cx - eyeDX, eyeY, 2.2, 2.6, [255, 255, 255]);
    sheet.disc(cx + eyeDX, eyeY, 2.2, 2.6, [255, 255, 255]);
    sheet.disc(cx - eyeDX + lookX, eyeY, 1.1, 1.3, [30, 20, 60]);
    sheet.disc(cx + eyeDX + lookX, eyeY, 1.1, 1.3, [30, 20, 60]);
  }

  // A little raised "hand" on waving.
  if (state === 'waving') {
    sheet.disc(cx + rx + 3, cy - ry * (0.6 + 0.3 * wave), 2.5, 2.5, body);
  }
}

// Build the full sheet for a pet definition and return { png, states }.
function buildSheet({ frameWidth = 32, frameHeight = 32, frames = 4, body, belly }) {
  const cols = frames;
  const rows = STATE_ORDER.length;
  const w = frameWidth * cols;
  const h = frameHeight * rows;
  const sheet = makeCanvas(w, h);
  const bodyRgb = hexToRgb(body);
  const bellyRgb = hexToRgb(belly);

  const states = {};
  STATE_ORDER.forEach((state, row) => {
    states[state] = { row, frames, durationMs: state === 'running' ? 90 : 150 };
    for (let phase = 0; phase < frames; phase++) {
      drawCreature(sheet, phase * frameWidth, row * frameHeight, frameWidth, frameHeight, {
        body: bodyRgb, belly: bellyRgb, state, phase, frames,
      });
    }
  });

  return { png: encodePNG(sheet.buf, w, h), states };
}

// Write a complete pet pack (sheet.png + pet.json) into pets/<id>/.
function writePack(petsDir, def) {
  const dir = path.join(petsDir, def.id);
  fs.mkdirSync(dir, { recursive: true });
  const { png, states } = buildSheet(def);
  fs.writeFileSync(path.join(dir, 'sheet.png'), png);
  const petJson = {
    id: def.id,
    name: def.name,
    render: 'sprite',
    sheet: 'sheet.png',
    frameWidth: def.frameWidth || 32,
    frameHeight: def.frameHeight || 32,
    scale: def.scale || 4,
    placeholder: true,
    states,
  };
  fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(petJson, null, 2) + '\n');
  return dir;
}

module.exports = { buildSheet, writePack, STATE_ORDER };

// Run directly: generate the default placeholder pack set.
if (require.main === module) {
  const petsDir = path.join(__dirname, '..', 'pets');
  const defs = [
    { id: 'blob',  name: 'Blobby',      frames: 4, body: '#5be37a', belly: '#d6ffe0' },
    { id: 'ghost', name: 'Boo',         frames: 4, body: '#b9a7ff', belly: '#efe9ff' },
    { id: 'ember', name: 'Ember',       frames: 4, body: '#ff8a5b', belly: '#ffe0cf' },
  ];
  for (const d of defs) {
    const dir = writePack(petsDir, d);
    console.log('wrote', path.relative(process.cwd(), dir));
  }
}
