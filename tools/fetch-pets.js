// fetch-pets.js — populate pets/ with sprite packs.
//
// Strategy: download real CC0 art from OpenGameArt (direct file URLs, no login).
// CC0 sheets are irregular, so each source is described explicitly below. If any
// download or extraction fails, we fall back to a generated placeholder pack so
// the multi-pet feature always works offline. Placeholder packs (blob/ghost/ember)
// are generated unconditionally as a baseline.
//
// Run: node tools/fetch-pets.js
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { writePack } = require('./make-placeholder');

const PETS_DIR = path.join(__dirname, '..', 'pets');
const TMP = path.join(__dirname, '_dl');

// CC0 sources. `frameMap` describes how to turn the downloaded sheet into our
// pet.json. These are single-animation packs: one looping clip used for every
// state (the renderer falls back to `idle` for any state we don't define).
const SOURCES = [
  {
    id: 'slime',
    name: 'Green Slime',
    url: 'https://opengameart.org/sites/default/files/Slime_0.zip',
    sheetInZip: 'slime-Sheet.png',
    license: 'CC0 1.0 — OpenGameArt (https://opengameart.org/content/pixel-art-animated-slime)',
    frameWidth: 32,
    frameHeight: 25,  // sheet is 4 cols x 32px wide, 5 rows x 25px tall (not 32)
    scale: 4,
    cols: 4,
    frames: 16,       // first 4 full rows of the 128x128 sheet (row 5 has 1 frame)
    durationMs: 110,
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return resolve(download(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    });
    req.on('error', (e) => { file.close(); reject(e); });
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

// Read PNG dimensions from the IHDR chunk (validates it's a real PNG too).
function pngSize(buf) {
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Build pet.json for a single-animation sheet: every canonical state points at
// the same clip via explicit frame coordinates (x,y per frame).
function spriteFromStrip(src, sheetBuf) {
  const { width, height } = pngSize(sheetBuf);
  const cols = src.cols;
  const frames = Math.min(src.frames, Math.floor(width / src.frameWidth) * Math.floor(height / src.frameHeight));
  const coords = [];
  for (let i = 0; i < frames; i++) {
    coords.push({ x: (i % cols) * src.frameWidth, y: Math.floor(i / cols) * src.frameHeight });
  }
  const clip = { frames: coords, durationMs: src.durationMs };
  const states = {};
  for (const s of ['idle', 'review', 'running', 'waiting', 'waving', 'jumping', 'failed']) {
    states[s] = clip;
  }
  return {
    id: src.id,
    name: src.name,
    render: 'sprite',
    sheet: 'sheet.png',
    frameWidth: src.frameWidth,
    frameHeight: src.frameHeight,
    scale: src.scale || 4,
    states,
  };
}

async function tryFetch(src) {
  fs.mkdirSync(TMP, { recursive: true });
  const zipPath = path.join(TMP, `${src.id}.zip`);
  await download(src.url, zipPath);

  // Extract just the sheet we need using PowerShell's Expand-Archive (Windows).
  const outDir = path.join(TMP, src.id);
  fs.rmSync(outDir, { recursive: true, force: true });
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir}' -Force`,
  ], { stdio: 'ignore' });

  // Find the sheet (may be nested in a subfolder).
  const found = findFile(outDir, src.sheetInZip);
  if (!found) throw new Error(`${src.sheetInZip} not found in archive`);
  const sheetBuf = fs.readFileSync(found);
  const petJson = spriteFromStrip(src, sheetBuf);

  const dir = path.join(PETS_DIR, src.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sheet.png'), sheetBuf);
  fs.writeFileSync(path.join(dir, 'pet.json'), JSON.stringify(petJson, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'CREDITS.txt'),
    `${src.name}\nSource: ${src.url}\nLicense: ${src.license}\n`);
  return dir;
}

function findFile(root, name) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) { const r = findFile(full, name); if (r) return r; }
    else if (entry.name === name) return full;
  }
  return null;
}

// Placeholder defs (always generated — they need no network).
const PLACEHOLDERS = [
  { id: 'blob',  name: 'Blobby', frames: 4, body: '#5be37a', belly: '#d6ffe0' },
  { id: 'ghost', name: 'Boo',    frames: 4, body: '#b9a7ff', belly: '#efe9ff' },
  { id: 'ember', name: 'Ember',  frames: 4, body: '#ff8a5b', belly: '#ffe0cf' },
];

(async () => {
  fs.mkdirSync(PETS_DIR, { recursive: true });

  for (const d of PLACEHOLDERS) {
    writePack(PETS_DIR, d);
    console.log('placeholder:', d.id);
  }

  for (const src of SOURCES) {
    try {
      await tryFetch(src);
      console.log('downloaded CC0:', src.id);
    } catch (err) {
      console.warn(`download failed for ${src.id} (${err.message}); using placeholder`);
      writePack(PETS_DIR, { id: src.id, name: src.name, frames: 4, body: '#7ad6ff', belly: '#e6f8ff' });
    }
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('done. pets in', path.relative(process.cwd(), PETS_DIR));
})();
