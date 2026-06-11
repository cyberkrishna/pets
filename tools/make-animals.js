// make-animals.js — procedurally draws cute chibi animal pet packs (cat, fox,
// bunny) as 32x32 pixel-art sprite sheets, using the same zero-dep PNG encoder
// as the other generators. One row per animation state (OpenPets layout),
// 4 frames per row. Also writes a 4x preview.png per pack for eyeballing.
//
//   node tools/make-animals.js
const fs = require('fs');
const path = require('path');
const { encodePNG } = require('./png');

const W = 32, H = 32, FRAMES = 4;
const STATES = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'];

// ── tiny pixel canvas ─────────────────────────────────────────────────────────
function canvas() { return Buffer.alloc(W * H * 4); }
function px(b, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  b[i] = c[0]; b[i + 1] = c[1]; b[i + 2] = c[2]; b[i + 3] = c[3] === undefined ? 255 : c[3];
}
function rect(b, x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(b, x, y, c); }
function disc(b, cx, cy, r, c) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.4) px(b, x, y, c);
}
function tri(b, [x1, y1], [x2, y2], [x3, y3], c) {
  const minX = Math.min(x1, x2, x3), maxX = Math.max(x1, x2, x3);
  const minY = Math.min(y1, y2, y3), maxY = Math.max(y1, y2, y3);
  const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d;
    const bb = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d;
    const cc = 1 - a - bb;
    if (a >= -0.05 && bb >= -0.05 && cc >= -0.05) px(b, x, y, c);
  }
}
function mirrorFrame(b) {
  const out = canvas();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, j = (y * W + (W - 1 - x)) * 4;
    out[j] = b[i]; out[j + 1] = b[i + 1]; out[j + 2] = b[i + 2]; out[j + 3] = b[i + 3];
  }
  return out;
}

// ── palettes / species ────────────────────────────────────────────────────────
const EYE = [42, 36, 79];
const WHITE = [255, 255, 255];
const TEAR = [110, 190, 255];
const BLUSH = [255, 140, 170];
const HEART = [255, 90, 120];

const SPECIES = {
  cat: {
    name: 'Pixel Cat',
    body: [138, 143, 160], dark: [95, 99, 115], light: [232, 234, 242], inner: [240, 182, 200],
    ears: 'cat', whiskers: true, tail: 'curl',
  },
  fox: {
    name: 'Pixel Fox',
    body: [232, 133, 60], dark: [176, 95, 34], light: [255, 243, 224], inner: [255, 222, 200],
    ears: 'fox', whiskers: false, tail: 'fluff',
  },
  bunny: {
    name: 'Pixel Bunny',
    body: [242, 240, 234], dark: [201, 197, 186], light: [255, 255, 255], inner: [245, 184, 200],
    ears: 'bunny', whiskers: true, tail: 'none',
  },
};

// ── one frame ────────────────────────────────────────────────────────────────
// state: logical animation; i: frame index 0..3.
function drawFrame(spec, state, i) {
  const b = canvas();
  const P = spec;

  // Vertical bob / jump offsets per state.
  const bob = { idle: [0, 0, 1, 1], waiting: [0, 1, 0, 1], review: [0, 0, 1, 1], running: [0, 1, 0, 1], 'running-right': [0, 1, 0, 1], waving: [0, 0, 1, 0] }[state] || [0, 0, 0, 0];
  let dy = bob[i] || 0;
  let dx = 0;
  if (state === 'jumping') dy = [1, -3, -5, -1][i];
  if (state === 'failed') dy = 3;
  if (state === 'running-right') dx = [0, 1, 1, 0][i];
  const droop = state === 'failed';

  // Tail (drawn first so the body overlaps its base).
  const sway = [0, 1, 1, 0][i];
  if (P.tail === 'curl') {
    for (let t = 0; t < 7; t++) {
      px(b, 23 + sway + (t > 4 ? 1 : 0), 26 + dy - t, P.dark);
      px(b, 24 + sway + (t > 4 ? 1 : 0), 26 + dy - t, P.dark);
    }
    px(b, 25 + sway, 19 + dy, P.dark); px(b, 26 + sway, 20 + dy, P.dark); // curled tip
  } else if (P.tail === 'fluff') {
    disc(b, 26 + sway, 23 + dy, 3, P.dark);
    disc(b, 27 + sway, 22 + dy, 2, P.light); // white tip
  }

  // Ears (before head, head circle covers their base).
  const earDy = droop ? 4 : (state === 'waiting' ? -1 : 0);
  if (P.ears === 'cat' || P.ears === 'fox') {
    const s = P.ears === 'fox' ? 2 : 0; // fox ears bigger
    tri(b, [8, 2 + earDy + (droop ? 2 : 0)], [5, 9 + earDy], [14, 7 + earDy], P.body);
    tri(b, [24, 2 + earDy + (droop ? 2 : 0)], [27, 9 + earDy], [18, 7 + earDy], P.body);
    tri(b, [9, 4 + earDy + (droop ? 2 : 0)], [7, 8 + earDy], [12, 7 + earDy], P.inner);
    tri(b, [23, 4 + earDy + (droop ? 2 : 0)], [25, 8 + earDy], [20, 7 + earDy], P.inner);
    if (s) { tri(b, [8, 0 + earDy], [6, 6 + earDy], [12, 5 + earDy], P.body); tri(b, [24, 0 + earDy], [26, 6 + earDy], [20, 5 + earDy], P.body); }
  } else if (P.ears === 'bunny') {
    const wig = [0, 1, 0, -1][i]; // ears wiggle
    const ed = droop ? 3 : 0;
    rect(b, 9 + wig, 0 + ed, 12 + wig, 9 + ed, P.body);
    rect(b, 10 + wig, 2 + ed, 11 + wig, 8 + ed, P.inner);
    rect(b, 20 - wig, 0 + ed, 23 - wig, 9 + ed, P.body);
    rect(b, 21 - wig, 2 + ed, 22 - wig, 8 + ed, P.inner);
  }

  // Body + head (chibi: big head over small body).
  disc(b, 16 + dx, 23 + dy, 6, P.body);
  rect(b, 11 + dx, 25 + dy, 21 + dx, 27 + dy, P.body);
  disc(b, 16 + dx, 25 + dy, 3, P.light); // belly
  disc(b, 16 + dx, 12 + dy, 8, P.body);  // head

  // Muzzle patch.
  rect(b, 13 + dx, 13 + dy, 19 + dx, 16 + dy, P.light);

  // Front paws; waving raises one.
  rect(b, 11 + dx, 26 + dy, 13 + dx, 28 + dy, P.dark);
  if (state === 'waving' && i % 2 === 0) {
    rect(b, 23 + dx, 16 + dy, 25 + dx, 18 + dy, P.dark); // paw up!
  } else {
    rect(b, 19 + dx, 26 + dy, 21 + dx, 28 + dy, P.dark);
  }

  // Eyes — the emotional core. lx/rx are eye centers.
  const lx = 12 + dx, rx = 20 + dx, ey = 11 + dy;
  const blink = state === 'idle' && i === 3;
  if (state === 'jumping' || state === 'waving') {
    // happy ^^ eyes
    px(b, lx - 1, ey, EYE); px(b, lx, ey - 1, EYE); px(b, lx + 1, ey, EYE);
    px(b, rx - 1, ey, EYE); px(b, rx, ey - 1, EYE); px(b, rx + 1, ey, EYE);
  } else if (state === 'failed') {
    // >< eyes + tear
    px(b, lx - 1, ey - 1, EYE); px(b, lx, ey, EYE); px(b, lx - 1, ey + 1, EYE);
    px(b, rx + 1, ey - 1, EYE); px(b, rx, ey, EYE); px(b, rx + 1, ey + 1, EYE);
    if (i % 2 === 0) { px(b, lx - 2, ey + 2, TEAR); px(b, lx - 2, ey + 3, TEAR); }
  } else if (blink) {
    rect(b, lx - 1, ey, lx + 1, ey, EYE);
    rect(b, rx - 1, ey, rx + 1, ey, EYE);
  } else {
    const wide = state === 'waiting';
    const look = state === 'review' ? -1 : 0; // thinking: eyes drift left
    rect(b, lx - 1, ey - 1, lx + 1, ey + (wide ? 2 : 1), WHITE);
    rect(b, rx - 1, ey - 1, rx + 1, ey + (wide ? 2 : 1), WHITE);
    rect(b, lx + look, ey + (wide ? 0 : 0), lx + look, ey + 1, EYE);
    rect(b, rx + look, ey + (wide ? 0 : 0), rx + look, ey + 1, EYE);
    if (wide) { px(b, lx + 1, ey, WHITE); px(b, rx + 1, ey, WHITE); } // sparkle
  }

  // Nose + mouth.
  px(b, 16 + dx, 14 + dy, P.inner);
  if (state === 'failed') {
    px(b, 15 + dx, 17 + dy, EYE); px(b, 16 + dx, 16 + dy, EYE); px(b, 17 + dx, 17 + dy, EYE); // frown
  } else if (state === 'jumping' || state === 'waving') {
    rect(b, 15 + dx, 16 + dy, 17 + dx, 16 + dy, EYE); px(b, 16 + dx, 17 + dy, EYE); // open smile
  } else {
    px(b, 15 + dx, 16 + dy, EYE); px(b, 17 + dx, 16 + dy, EYE); // :3
  }

  // Blush.
  px(b, 9 + dx, 14 + dy, BLUSH); px(b, 10 + dx, 14 + dy, BLUSH);
  px(b, 22 + dx, 14 + dy, BLUSH); px(b, 23 + dx, 14 + dy, BLUSH);

  // Whiskers.
  if (P.whiskers) {
    px(b, 6 + dx, 13 + dy, P.dark); px(b, 7 + dx, 13 + dy, P.dark);
    px(b, 25 + dx, 13 + dy, P.dark); px(b, 26 + dx, 13 + dy, P.dark);
  }

  // State garnish.
  if (state === 'review' && i >= 2) { px(b, 27, 4, WHITE); px(b, 28, 3, WHITE); px(b, 28, 5, WHITE); px(b, 27 + 1, 4, WHITE); } // sparkle "?"
  if (state === 'waiting' && i % 2 === 1) { rect(b, 27, 2, 28, 6, HEART); rect(b, 27, 8, 28, 9, HEART); } // "!" attention mark
  if ((state === 'running' || state === 'running-right') && i % 2 === 1) {
    px(b, 4, 20 + dy, P.dark); px(b, 5, 20 + dy, P.dark); px(b, 3, 23 + dy, P.dark); px(b, 4, 23 + dy, P.dark); // motion dashes
  }

  return b;
}

// ── assemble sheet ────────────────────────────────────────────────────────────
function buildSheet(spec) {
  const sheet = Buffer.alloc(W * FRAMES * H * STATES.length * 4);
  const sheetW = W * FRAMES;
  STATES.forEach((state, row) => {
    for (let i = 0; i < FRAMES; i++) {
      let frame;
      if (state === 'running-left') frame = mirrorFrame(drawFrame(spec, 'running-right', i));
      else frame = drawFrame(spec, state, i);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const src = (y * W + x) * 4;
        const dst = ((row * H + y) * sheetW + i * W + x) * 4;
        frame.copy(sheet, dst, src, src + 4);
      }
    }
  });
  return { sheet, width: sheetW, height: H * STATES.length };
}

function upscale(buf, w, h, k) {
  const out = Buffer.alloc(w * k * h * k * 4);
  for (let y = 0; y < h * k; y++) for (let x = 0; x < w * k; x++) {
    const src = ((y / k | 0) * w + (x / k | 0)) * 4;
    const dst = (y * w * k + x) * 4;
    buf.copy(out, dst, src, src + 4);
  }
  return out;
}

function petJson(id, spec) {
  return {
    id, name: spec.name, render: 'sprite', sheet: 'sheet.png',
    frameWidth: W, frameHeight: H, scale: 4,
    states: {
      'idle':          { row: 0, frames: 4, durationMs: 400 },
      'running-right': { row: 1, frames: 4, durationMs: 110 },
      'running-left':  { row: 2, frames: 4, durationMs: 110 },
      'waving':        { row: 3, frames: 4, durationMs: 150, iterations: 3 },
      'jumping':       { row: 4, frames: 4, durationMs: 140, iterations: 2 },
      'failed':        { row: 5, frames: 4, durationMs: 240, iterations: 2 },
      'waiting':       { row: 6, frames: 4, durationMs: 220 },
      'running':       { row: 7, frames: 4, durationMs: 130 },
      'review':        { row: 8, frames: 4, durationMs: 280 },
    },
  };
}

for (const [id, spec] of Object.entries(SPECIES)) {
  const dir = path.join(__dirname, '..', 'pets', id);
  fs.mkdirSync(dir, { recursive: true });
  const { sheet, width, height } = buildSheet(spec);
  fs.writeFileSync(path.join(dir, 'sheet.png'), encodePNG(sheet, width, height));
  fs.writeFileSync(path.join(dir, 'preview.png'), encodePNG(upscale(sheet, width, height, 4), width * 4, height * 4));
  fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(petJson(id, spec), null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'CREDITS.txt'), `${spec.name}: original pixel art generated procedurally by tools/make-animals.js (this repo). No external assets.\n`);
  console.log(`wrote pets/${id} (${width}x${height})`);
}
